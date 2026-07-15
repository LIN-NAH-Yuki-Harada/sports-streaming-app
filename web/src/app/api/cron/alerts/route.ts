import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const FROM_ADDRESS = "LIVE SPOtCH <onboarding@resend.dev>";

// 走査範囲の絞り込み。重複通知の防止は alert_log の UNIQUE(kind, ref_id) が担うため、
// この窓は「古い障害まで毎回スキャンしない」ためのもの。
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

const KIND_LABELS: Record<string, string> = {
  live_error: "ライブ配信エラー (live_error)",
  archive_failed: "アーカイブ処理失敗 (youtube_upload_status=failed)",
};

type BroadcastRow = {
  id: string;
  share_code: string;
  home_team: string;
  away_team: string;
  started_at: string | null;
};

type Alert = {
  kind: "live_error" | "archive_failed";
  ref_id: string;
  detail: string | null;
  broadcast: BroadcastRow;
};

export async function GET(request: Request) {
  // Vercel Cron の認証チェック（タイミング攻撃対策）
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

  const admin = getAdminClient();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  // 1. ライブ配信エラー（YouTube Live 連携失敗・auto-cleanup 検知など）
  const { data: liveErrors, error: liveErr } = await admin
    .from("broadcasts")
    .select("id, share_code, home_team, away_team, started_at, live_error")
    .not("live_error", "is", null)
    .gte("started_at", since)
    .limit(50);
  if (liveErr) {
    console.error("[cron/alerts] live_error select failed:", liveErr);
    return Response.json({ error: "DB select failed" }, { status: 500 });
  }

  // 2. アーカイブ処理の失敗（Vercel cron / VPS ワーカー両パイプライン共通で failed に確定）
  const { data: uploadFails, error: upErr } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, home_team, away_team, started_at, youtube_upload_error",
    )
    .eq("youtube_upload_status", "failed")
    .gte("started_at", since)
    .limit(50);
  if (upErr) {
    console.error("[cron/alerts] upload failed select failed:", upErr);
    return Response.json({ error: "DB select failed" }, { status: 500 });
  }

  const candidates: Alert[] = [
    ...(liveErrors ?? []).map(
      (b): Alert => ({
        kind: "live_error",
        ref_id: b.id,
        detail: b.live_error,
        broadcast: b,
      }),
    ),
    ...(uploadFails ?? []).map(
      (b): Alert => ({
        kind: "archive_failed",
        ref_id: b.id,
        detail: b.youtube_upload_error,
        broadcast: b,
      }),
    ),
  ];
  if (candidates.length === 0) {
    return Response.json({ checked: 0, notified: 0 });
  }

  // 3. 未通知のものだけ抽出（挿入できた行 = 新規。既送信は UNIQUE 衝突でスキップされる）
  const { data: inserted, error: logErr } = await admin
    .from("alert_log")
    .upsert(
      candidates.map(({ kind, ref_id, detail }) => ({ kind, ref_id, detail })),
      { onConflict: "kind,ref_id", ignoreDuplicates: true },
    )
    .select("kind, ref_id");
  if (logErr) {
    console.error("[cron/alerts] alert_log upsert failed:", logErr);
    return Response.json({ error: "alert_log upsert failed" }, { status: 500 });
  }

  const newKeys = new Set(
    (inserted ?? []).map((r) => `${r.kind}:${r.ref_id}`),
  );
  const fresh = candidates.filter((c) => newKeys.has(`${c.kind}:${c.ref_id}`));
  if (fresh.length === 0) {
    return Response.json({ checked: candidates.length, notified: 0 });
  }

  // 4. オーナー宛にまとめて1通送信
  const resendKey = process.env.RESEND_API_KEY;
  const to =
    process.env.ALERT_NOTIFICATION_EMAIL ??
    process.env.CONTACT_NOTIFICATION_EMAIL;
  if (!resendKey || !to) {
    // メール未設定でも alert_log には記録済み（設定後の再通知はしない）
    console.warn(
      "[cron/alerts] Resend not configured — email skipped (RESEND_API_KEY or ALERT/CONTACT_NOTIFICATION_EMAIL missing)",
    );
    return Response.json({
      checked: candidates.length,
      notified: fresh.length,
      emailed: false,
    });
  }

  const liveCount = fresh.filter((f) => f.kind === "live_error").length;
  const archiveCount = fresh.length - liveCount;
  const resend = new Resend(resendKey);
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [to],
      subject: `[LIVE SPOtCH] 障害アラート ${fresh.length}件（ライブ${liveCount} / アーカイブ${archiveCount}）`,
      html: buildAlertHtml(fresh),
    });
    if (result.error) {
      throw new Error(result.error.message);
    }
  } catch (e) {
    // 送信失敗時は alert_log から取り消して次の tick で再通知させる
    console.error("[cron/alerts] resend send failed:", e);
    for (const f of fresh) {
      await admin
        .from("alert_log")
        .delete()
        .eq("kind", f.kind)
        .eq("ref_id", f.ref_id);
    }
    return Response.json({ error: "email send failed" }, { status: 500 });
  }

  return Response.json({
    checked: candidates.length,
    notified: fresh.length,
    emailed: true,
  });
}

function escapeHtml(s: string) {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function formatJst(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildAlertHtml(alerts: Alert[]) {
  const rows = alerts
    .map((a) => {
      const b = a.broadcast;
      return `<div style="margin-top:16px;background:#f9f9f9;border-radius:8px;padding:16px;font-size:14px;">
        <div style="font-weight:600;color:#e63946;">${escapeHtml(KIND_LABELS[a.kind] ?? a.kind)}</div>
        <div style="margin-top:8px;">${escapeHtml(b.home_team)} vs ${escapeHtml(b.away_team)}（開始 ${escapeHtml(formatJst(b.started_at))}）</div>
        <div style="margin-top:4px;color:#888;font-size:12px;">share_code: ${escapeHtml(b.share_code)} / id: ${escapeHtml(b.id)}</div>
        <div style="margin-top:8px;white-space:pre-wrap;font-family:monospace;font-size:12px;background:#fff;border:1px solid #eee;border-radius:6px;padding:8px;">${escapeHtml(a.detail ?? "(詳細なし)")}</div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:#e63946;color:#fff;padding:16px 24px;">
      <div style="font-size:14px;font-weight:600;letter-spacing:0.02em;">LIVE SPOtCH</div>
      <div style="font-size:11px;opacity:0.9;margin-top:2px;">障害アラート（自動通知）</div>
    </div>
    <div style="padding:24px;color:#1a1a1a;line-height:1.7;">
      <p style="margin:0;font-size:14px;">直近の配信で ${alerts.length} 件の障害を検知しました。</p>
      ${rows}
      <p style="margin-top:24px;font-size:12px;color:#888;">診断の第一歩: Supabase の broadcasts.live_error / youtube_upload_error → VPS の journalctl。</p>
    </div>
  </div>
</body></html>`;
}
