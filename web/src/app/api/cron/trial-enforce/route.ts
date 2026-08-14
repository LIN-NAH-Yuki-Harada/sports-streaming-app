import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { sendPlanPitchEmail } from "@/lib/emails/plan-pitch";
import { recordHeartbeat } from "@/lib/ops-heartbeat";
import { getAdminClient } from "@/lib/supabase-admin";
import {
  TRIAL_MAX_SECONDS,
  TRIAL_PROFILE_COLUMNS,
  type TrialProfile,
  enforceMaxPerTick,
  remainingSeconds,
  shouldCutBroadcast,
  trialEnforceMode,
} from "@/lib/trial";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 無料プラン10分制限のサーバー側バックストップ（1分毎）。
 *
 * 【何が起きていたか】
 *   10分制限の実体は「配信アプリのクライアントタイマー」と、旧 LiveKit 経路の
 *   トークン発行時チェック（api/livekit/token）だけだった。本経路である自前RTMP
 *   （api/stream/provision → MediaMTX）には判定が1行も無いため、アプリの
 *   タイマーが働かない状況（旧ビルド・Web 経路・plan 取得失敗 等）では
 *   無料プランが無制限に配信できていた。実データでも無料31本中5本が10分超・
 *   最長295分で、課金プランの誰より長く配信できている状態だった。
 *
 * 【どう直すか】
 *   配信経路（RTMP / LiveKit）に依存せず、DB の状態だけでアプリと同じ式を再現し、
 *   超過した配信の broadcasts.status を 'ended' にする。視聴ページは Realtime で
 *   数秒以内に停止するため、収益上の強制はこれで成立する。
 *
 * 【絶対に守る制約】
 *   誤爆＝課金ユーザーの試合を止める、が最悪の事故。判定できない要素が1つでもあれば
 *   止めない（lib/trial.ts の isEnforceableFree）。加えて 1 tick の上限（サーキットブレーカ）を
 *   超えたら1本も切らずオーナー通報のみ行う。
 *
 * 【段階導入】TRIAL_ENFORCE_MODE = off（既定）→ dry（対象を数えるだけ）→ on（実際に止める）
 */

// 走査窓。6時間より前に始まった live はゴースト掃除（cron/cleanup・VPS worker）の担当。
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
// 心拍がこの時間途絶していたら「本当に生きている配信」ではない＝ここでは触らない。
// cron/cleanup の STALE_MINUTES=5 と揃える（境界を跨ぐと二重終了になるため）。
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
// 1 tick で見る live 配信の上限。
const SCAN_LIMIT = 200;

type LiveRow = {
  id: string;
  broadcaster_id: string;
  started_at: string | null;
  last_seen_at: string | null;
  share_code: string | null;
};

export async function GET(request: Request) {
  // Vercel Cron の認証チェック（タイミング攻撃対策・cron/cleanup と同一）
  const authHeader = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(authHeader);
  const authorized =
    !!process.env.CRON_SECRET &&
    expectedBuf.length === actualBuf.length &&
    timingSafeEqual(expectedBuf, actualBuf);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // cron が動いている証拠を1行残す（絶対に throw しない・3秒で打ち切る）。
  // ★これが5本の中で最も高頻度（毎分）なので、ウォッチドッグの鮮度判定の主軸になる。
  // kill switch より前に置く: mode=off でも「cron 自体は生きている」ことを記録したい。
  await recordHeartbeat("cron:trial-enforce");

  // ★ kill switch。env を off に戻して Redeploy すれば以降は何もしない。
  const mode = trialEnforceMode();
  if (mode === "off") {
    return Response.json({ skipped: "disabled" });
  }

  const admin = getAdminClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. 「本当に生きている」live 配信を集める（transport 非依存＝RTMP / LiveKit 共通）
  const { data: liveRows, error: liveErr } = await admin
    .from("broadcasts")
    .select("id, broadcaster_id, started_at, last_seen_at, share_code")
    .eq("status", "live")
    .gte("started_at", new Date(now - LOOKBACK_MS).toISOString())
    .limit(SCAN_LIMIT);
  if (liveErr) {
    console.error("[cron/trial-enforce] live select failed:", liveErr.message);
    return Response.json({ error: "DB select failed" }, { status: 500 });
  }

  // 心拍が途絶しているものはゴースト。掃除は cron/cleanup と VPS worker の担当なので触らない
  // （ここで終了させると担当が二重になり、どちらの仕業か追えなくなる）。
  const live = ((liveRows ?? []) as LiveRow[]).filter((b) => {
    if (!b.last_seen_at) return false;
    const seen = Date.parse(b.last_seen_at);
    return Number.isFinite(seen) && now - seen < HEARTBEAT_STALE_MS;
  });
  if (live.length === 0) {
    return Response.json({ mode, scanned: 0, cut: 0 });
  }

  // 2. 配信者の profiles を1クエリで一括取得（N+1 にしない）
  const broadcasterIds = [...new Set(live.map((b) => b.broadcaster_id))];
  const { data: profileRows, error: profErr } = await admin
    .from("profiles")
    .select(`id, ${TRIAL_PROFILE_COLUMNS}`)
    .in("id", broadcasterIds);
  if (profErr) {
    // ★ 読めなかったときに「全員 free 扱い」で進むのが最悪。ここで必ず打ち切る。
    console.error("[cron/trial-enforce] profiles select failed:", profErr.message);
    return Response.json({ error: "profiles select failed" }, { status: 500 });
  }

  const profiles = new Map<string, TrialProfile>();
  for (const row of (profileRows ?? []) as (TrialProfile & { id: string })[]) {
    profiles.set(row.id, row);
  }

  // 3. 判定（アプリのカウントダウンと同一式＋GRACE）
  const targets = live.filter((b) =>
    shouldCutBroadcast({
      profile: profiles.get(b.broadcaster_id),
      startedAt: b.started_at,
      nowMs: now,
    }),
  );

  // 4. ★サーキットブレーカ。webhook 障害等で多数の profiles.plan が一斉に free に落ちると
  //    試合中の課金者を大量に切ってしまう。上限を超えた tick は1本も切らず通報だけする。
  const maxPerTick = enforceMaxPerTick();
  if (targets.length > maxPerTick) {
    console.error(
      `[cron/trial-enforce] tripped: ${targets.length} targets > max ${maxPerTick} — cut nothing`,
    );
    await notifyOwnerTripped(admin, targets.length, maxPerTick, now);
    return Response.json({
      mode,
      scanned: live.length,
      tripped: true,
      would: targets.length,
      cut: 0,
    });
  }

  // 5. dry-run: 何も書かずに件数だけ返す。ロールアウトはここで最低数日観測してから on にする。
  if (mode === "dry") {
    for (const t of targets) {
      const p = profiles.get(t.broadcaster_id);
      console.info(
        `[cron/trial-enforce] dry target broadcast=${t.id} share=${t.share_code ?? "-"} remaining=${remainingSeconds(p)}s started=${t.started_at}`,
      );
    }
    return Response.json({
      mode,
      scanned: live.length,
      dryRun: targets.length,
      cut: 0,
    });
  }

  // 6. 実行
  let cut = 0;
  for (const t of targets) {
    // CAS: status='live' を WHERE に残す＝配信者の正規終了と競合しない（0行なら既に終了済）。
    const { data: updated, error: upErr } = await admin
      .from("broadcasts")
      .update({ status: "ended", ended_at: nowIso })
      .eq("id", t.id)
      .eq("status", "live")
      .select("id");
    if (upErr) {
      console.error(
        `[cron/trial-enforce] update failed broadcast=${t.id}:`,
        upErr.message,
      );
      continue;
    }
    if (!updated || updated.length === 0) continue; // 既に終了済み → 何もしない
    cut++;

    // 次回の開始を、既に出荷済みのアプリ内ゲート（plan==='free' && 残り<=0 で開始不可）に塞がせる。
    // trial-consume はクライアントが終了処理を走らせないと呼ばれないため、ここで確定させる。
    const { error: consumeErr } = await admin
      .from("profiles")
      .update({ trial_seconds_used: TRIAL_MAX_SECONDS })
      .eq("id", t.broadcaster_id);
    if (consumeErr) {
      console.error(
        `[cron/trial-enforce] trial_seconds_used update failed user=${t.broadcaster_id}:`,
        consumeErr.message,
      );
    }

    // 配信者への通知。出荷済みアプリにはサーバー→端末の通知経路が無いため、
    // 「なぜ止まったか」を伝えられるのはメールだけ（送信失敗は握りつぶされる）。
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(
        t.broadcaster_id,
      );
      const email = authUser?.user?.email;
      if (email) {
        await sendPlanPitchEmail({ email, context: "trial_end" });
      }
    } catch (e) {
      console.warn(
        "[cron/trial-enforce] plan pitch mail skipped:",
        e instanceof Error ? e.message : "unknown",
      );
    }

    // ★ broadcasts.live_error には書かない。cron/alerts が live_error を拾うため、
    //   カットのたびにオーナーへ「障害アラート」が飛んで本物の障害が埋もれる。
    console.info(
      `[cron/trial-enforce] cut broadcast=${t.id} share=${t.share_code ?? "-"}`,
    );
  }

  return Response.json({ mode, scanned: live.length, targets: targets.length, cut });
}

/**
 * サーキットブレーカ作動時のオーナー通報。
 * alert_log の UNIQUE(kind, ref_id) を使って「1時間に1通」に抑える
 * （毎分作動しても受信箱が溢れないようにする）。
 */
async function notifyOwnerTripped(
  admin: ReturnType<typeof getAdminClient>,
  count: number,
  maxPerTick: number,
  now: number,
) {
  const hourKey = new Date(now).toISOString().slice(0, 13); // 例: 2026-08-12T07
  const { data: inserted, error } = await admin
    .from("alert_log")
    .upsert(
      [
        {
          kind: "trial_enforce_tripped",
          ref_id: hourKey,
          detail: `targets=${count} > max=${maxPerTick}`,
        },
      ],
      { onConflict: "kind,ref_id", ignoreDuplicates: true },
    )
    .select("ref_id");
  if (error) {
    console.error("[cron/trial-enforce] alert_log upsert failed:", error.message);
    return;
  }
  if (!inserted || inserted.length === 0) return; // この1時間は通知済み

  const resendKey = process.env.RESEND_API_KEY;
  const to =
    process.env.ALERT_NOTIFICATION_EMAIL ??
    process.env.CONTACT_NOTIFICATION_EMAIL;
  if (!resendKey || !to) {
    console.warn("[cron/trial-enforce] Resend not configured — email skipped");
    return;
  }
  try {
    await new Resend(resendKey).emails.send({
      from:
        process.env.RESEND_FROM_EMAIL || "LIVE SPOtCH <onboarding@resend.dev>",
      to: [to],
      subject: "[LIVE SPOtCH] 無料10分の自動停止を安全装置で停止しました",
      html: `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;color:#1a1a1a;line-height:1.8;">
    <div style="font-size:16px;font-weight:700;color:#e63946;">無料10分の自動停止を、安全装置が止めました</div>
    <p style="font-size:14px;">1分間に <b>${count} 本</b>の配信が「無料プランの10分超過」と判定されました
    （上限 ${maxPerTick} 本）。多すぎるため<b>1本も停止していません</b>。</p>
    <p style="font-size:14px;">課金の反映（Stripe / RevenueCat の webhook）が壊れて、
    有料プランの方が一時的に無料扱いになっている可能性があります。</p>
    <p style="font-size:13px;color:#666;">対処: Vercel の環境変数 <code>TRIAL_ENFORCE_MODE</code> を
    <code>off</code> にして Redeploy すると、この機能を完全に止められます。</p>
  </div>
</body></html>`,
    });
  } catch (e) {
    console.error("[cron/trial-enforce] tripped mail failed:", e);
  }
}
