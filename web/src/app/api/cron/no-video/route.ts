import { timingSafeEqual } from "node:crypto";
import { recordHeartbeat } from "@/lib/ops-heartbeat";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 「見えていない配信」の検知（2分毎）。
 *
 * 【何が起きていたか】
 *   マイクだけが繋がり、カメラのフレームが1枚も送られない配信が実在する。
 *   MediaMTX の実ログ（2026-08-12 07:26 / share_code 8N2NR5JT）:
 *     07:26:04 is publishing to path 'live/8N2NR5JT'
 *     07:26:04 stream is available and online, 1 track (MPEG-4 Audio)  ← 映像トラック0
 *     07:26:06 closing existing publisher                              ← 2秒後に2本目が接続
 *     07:26:18 closed: read: connection reset by peer                  ← 12秒で切断
 *   同じ配信者が 07/12(14秒) / 07/14(21秒) / 08/12(12秒) と3回とも同じ壊れ方をしている。
 *   配信者の画面は「配信中」のままなので本人は成功したと思い込み、視聴者は真っ暗。
 *   ＝現状は誰も気づけない。
 *
 * 【2種類の壊れ方を両方見る】
 *   (1) no_video : publish は続いているが音声トラックしかない
 *       → HLS のマルチバリアントプレイリスト（index.m3u8）の #EXT-X-STREAM-INF に
 *         RESOLUTION も 映像コーデック（avc1/hvc1/vp09/av01）も両方無い状態で判定する。
 *   (2) no_stream: DB は「配信中」なのに配信サーバーに何も届いていない（index.m3u8 が 404）
 *       → 上の実ログのように publish が即切れたケースはこちらに落ちる。
 *         MediaMTX は publisher が消えると 60秒ほどで muxer を閉じるため、
 *         開始から90秒後の初回プローブでは (1) ではなく (2) として見える。
 *   ※ MediaMTX の管理API(/v3/paths/*)なら tracks を直接読めるが、9997番が
 *     外部から到達不能なので Vercel からは使えない（VPS 側は手デプロイなので Phase 2）。
 *
 * 【このルートが書き込むもの】
 *   broadcasts.live_error（テキスト）と alert_log の行だけ。
 *   status / ended_at / plan / stream_playback_url には一切書かない＝配信は絶対に止まらない。
 *   オーナーへのメールは既存の cron/alerts が live_error を拾って送るので、
 *   新しいメール実装も新しいDDLも不要。
 */

// 開始直後は RTMP 接続前・初回セグメント生成前で「映像なし」に見える。90秒待つ。
const MIN_AGE_MS = 90_000;
// これ以降は判定済みのはずなので触らない（VPS への無駄なリクエストを増やさない）。
const MAX_AGE_MS = 30 * 60_000;
// index.m3u8 は初セグメントまでレスポンスをブロックしうるので必ず打ち切る。
const PROBE_TIMEOUT_MS = 4_000;
// 1回目の疑い（strike1）からこの間隔をあけた2回目で初めて確定する。
const CONFIRM_GAP_MS = 120_000;
// 1 tick で見る配信数の上限（並列 GET）。
const BATCH_LIMIT = 20;
// 心拍が途絶している配信はゴースト。掃除は cron/cleanup の担当なので最初から除く。
const HEARTBEAT_STALE_MS = 5 * 60_000;

const MESSAGES = {
  no_video:
    "no-video: HLS に映像トラックがありません（マイクだけが接続され、カメラのフレームが1枚も送られていない可能性）",
  no_stream:
    "no-stream: 配信サーバーに映像が届いていません（アプリは「配信中」と表示されたまま publish が切れている可能性）",
} as const;

// alert_log のマーカー種別。
//   nv_ok    = 判定完了（以後この配信はプローブしない）
//   nv_susp  = no_video の1回目の疑い
//   ns_susp  = no_stream の1回目の疑い
const MARK_KINDS = ["nv_ok", "nv_susp", "ns_susp"] as const;

type LiveRow = {
  id: string;
  share_code: string;
  stream_playback_url: string | null;
  last_seen_at: string | null;
};

type Verdict = "ok" | "no_video" | "no_stream" | "unknown";

const SUSP_KIND: Record<"no_video" | "no_stream", string> = {
  no_video: "nv_susp",
  no_stream: "ns_susp",
};

export async function GET(request: Request) {
  // Vercel Cron の認証チェック（タイミング攻撃対策・cron/alerts と同一）
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
  // kill switch より前に置く: off でも「cron 自体は生きている」ことを記録したい。
  await recordHeartbeat("cron:no-video");

  // ★ kill switch。NO_VIDEO_PROBE=off → Redeploy で即停止（ルート全体）。
  if (isOff("NO_VIDEO_PROBE")) {
    return Response.json({ skipped: "disabled" });
  }
  // (2) no_stream だけを黙らせたい場合の個別スイッチ（4G の長時間断で鳴りすぎるとき用）。
  const noStreamEnabled = !isOff("NO_STREAM_PROBE");

  const admin = getAdminClient();
  const now = Date.now();

  // 1. 対象＝自前RTMP経路（stream_playback_url あり）で、開始 90秒〜30分 の live 配信
  const { data: rows, error: selErr } = await admin
    .from("broadcasts")
    .select("id, share_code, stream_playback_url, last_seen_at")
    .eq("status", "live")
    .not("stream_playback_url", "is", null)
    .lt("started_at", new Date(now - MIN_AGE_MS).toISOString())
    .gt("started_at", new Date(now - MAX_AGE_MS).toISOString())
    .limit(BATCH_LIMIT);
  if (selErr) {
    console.error("[cron/no-video] broadcasts select failed:", selErr.message);
    return Response.json({ error: "DB select failed" }, { status: 500 });
  }

  const candidates = ((rows ?? []) as LiveRow[]).filter((r) => {
    if (!r.share_code) return false;
    if (!r.last_seen_at) return true; // 心拍が無い経路は判定対象から外さない
    const seen = Date.parse(r.last_seen_at);
    return !Number.isFinite(seen) || now - seen < HEARTBEAT_STALE_MS;
  });
  if (candidates.length === 0) {
    return Response.json({ checked: 0, suspected: 0, confirmed: 0 });
  }

  // 2. 判定済み(nv_ok)は二度と叩かない＝1配信あたりの GET を生涯 最大2回に固定する
  const { data: markRows, error: markErr } = await admin
    .from("alert_log")
    .select("kind, ref_id, created_at")
    .in(
      "ref_id",
      candidates.map((r) => r.id),
    )
    .in("kind", MARK_KINDS as unknown as string[]);
  if (markErr) {
    console.error("[cron/no-video] alert_log select failed:", markErr.message);
    return Response.json({ error: "alert_log select failed" }, { status: 500 });
  }
  const marks = new Map<string, string>(); // "kind:ref_id" -> created_at
  for (const m of (markRows ?? []) as {
    kind: string;
    ref_id: string;
    created_at: string;
  }[]) {
    marks.set(`${m.kind}:${m.ref_id}`, m.created_at);
  }

  const targets = candidates.filter((r) => !marks.has(`nv_ok:${r.id}`));
  if (targets.length === 0) {
    return Response.json({ checked: 0, suspected: 0, confirmed: 0 });
  }

  // 3. プローブ。CDN(CloudFront)ではなくオリジン(VPS)を叩く。
  //    index.m3u8 は Cache-Control: max-age=30 が付くため CDN 経由だと最大30秒古い。
  const host = process.env.STREAM_HOST?.trim();
  const verdicts = await Promise.all(targets.map((r) => probe(r, host, now)));

  // 4. ★集団誤爆ガード（VPS のゴースト掃除と同じ思想）
  //    3本以上を見て全部が「異常」なら、自分のパーサか上流（MediaMTX / Caddy / 回線）が
  //    まとめて壊れた疑い。個別配信のせいではないので、この tick は何も書かない。
  const badCount = verdicts.filter(
    (v) => v === "no_video" || v === "no_stream",
  ).length;
  if (targets.length >= 3 && badCount === targets.length) {
    console.error(
      `[cron/no-video] guard: all ${targets.length} probes abnormal — skipped (upstream or parser issue?)`,
    );
    return Response.json({
      guard: "all abnormal, skipped",
      checked: targets.length,
    });
  }

  let suspected = 0;
  let confirmed = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    let v = verdicts[i];
    if (v === "no_stream" && !noStreamEnabled) v = "unknown";

    if (v === "ok") {
      // 以後この配信は叩かない。立っていた疑いはリセットする。
      await upsertMark(admin, "nv_ok", r.id, null);
      for (const kind of ["nv_susp", "ns_susp"]) {
        if (marks.has(`${kind}:${r.id}`)) {
          await admin
            .from("alert_log")
            .delete()
            .eq("kind", kind)
            .eq("ref_id", r.id);
        }
      }
      continue;
    }

    // unknown（タイムアウト・5xx・想定外のプレイリスト形）は
    // strike を付けも消しもしない＝フェイルオープン。
    if (v !== "no_video" && v !== "no_stream") continue;

    const suspKind = SUSP_KIND[v];
    const strikeAt = marks.get(`${suspKind}:${r.id}`);
    if (!strikeAt) {
      // strike1。1回では絶対にアラートしない（再接続の一瞬を掴んだ可能性があるため）。
      await upsertMark(admin, suspKind, r.id, "strike1");
      suspected++;
      continue;
    }

    const strikeMs = Date.parse(strikeAt);
    if (!Number.isFinite(strikeMs) || now - strikeMs < CONFIRM_GAP_MS) continue;

    // strike2（120秒以上あけて2回連続の同じ異常）＝確定。
    // CAS: status='live' かつ live_error が未設定のときだけ書く（既存のエラーを上書きしない）。
    const { error: upErr } = await admin
      .from("broadcasts")
      .update({ live_error: MESSAGES[v] })
      .eq("id", r.id)
      .eq("status", "live")
      .is("live_error", null);
    if (upErr) {
      console.error(
        `[cron/no-video] live_error update failed broadcast=${r.id}:`,
        upErr.message,
      );
      continue;
    }
    // 以後は再プローブしない（＝同じ配信で2通目のメールも起きない）。
    await upsertMark(admin, "nv_ok", r.id, `confirmed_${v}`);
    confirmed++;
    console.error(
      `[cron/no-video] confirmed ${v} broadcast=${r.id} share=${r.share_code}`,
    );
  }

  return Response.json({ checked: targets.length, suspected, confirmed });
}

function isOff(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "off" || raw === "false" || raw === "0";
}

/**
 * index.m3u8 を取得して映像トラックの有無を判定する。
 * 判定できない要素が1つでもあれば "unknown"（＝無罪）に倒す。
 */
async function probe(
  r: LiveRow,
  host: string | undefined,
  now: number,
): Promise<Verdict> {
  // オリジン直（STREAM_HOST）を優先。未設定なら DB に保存された視聴URL（CDN 経由の可能性あり）。
  const base = host
    ? `https://${host}/live/${encodeURIComponent(r.share_code)}/index.m3u8`
    : r.stream_playback_url;
  if (!base) return "unknown";
  const url = `${base}${base.includes("?") ? "&" : "?"}_=${now}`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // タイムアウト・DNS・TLS などは全て無罪（フェイルオープン）
    return "unknown";
  }

  // 404 = MediaMTX にそのパスが無い＝配信サーバーに何も届いていない。
  // 再接続の一瞬でも起きるので、確定は2回連続（CONFIRM_GAP_MS）に委ねる。
  if (res.status === 404) return "no_stream";
  // 5xx などの上流都合は無罪。
  if (res.status !== 200) return "unknown";

  let body: string;
  try {
    body = await res.text();
  } catch {
    return "unknown";
  }
  const inf = body.match(/#EXT-X-STREAM-INF:[^\n]*/g) ?? [];
  // 構造ガード: マルチバリアントでない応答（将来の MediaMTX 更新等）は判定不能とする。
  if (inf.length === 0) return "unknown";
  const hasResolution = inf.some((line) => /,RESOLUTION=\d+x\d+/.test(line));
  const hasVideoCodec = inf.some((line) =>
    /CODECS="[^"]*(avc1|hvc1|hev1|vp09|av01)/.test(line),
  );
  // ★両方欠けて初めて有罪。片方だけの判定だと上流の1回のバージョンアップで全配信が誤検知になる。
  return hasResolution || hasVideoCodec ? "ok" : "no_video";
}

/** alert_log のマーカーを1行入れる（既にあれば何もしない）。 */
async function upsertMark(
  admin: ReturnType<typeof getAdminClient>,
  kind: string,
  refId: string,
  detail: string | null,
) {
  const { error } = await admin
    .from("alert_log")
    .upsert([{ kind, ref_id: refId, detail }], {
      onConflict: "kind,ref_id",
      ignoreDuplicates: true,
    });
  if (error) {
    console.warn(
      `[cron/no-video] mark ${kind} failed for ${refId}:`,
      error.message,
    );
  }
}
