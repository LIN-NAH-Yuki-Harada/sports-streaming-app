import { timingSafeEqual } from "node:crypto";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { getAdminClient } from "@/lib/supabase-admin";

// googleapis / Supabase Storage SDK が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

// アップロード失敗の最大リトライ回数。これを超えたら failed に確定する。
// cron 5 分間隔なので、完全失敗まで最大 25 分 (5 attempt × 5 分)。
const MAX_RETRY = 5;

/**
 * YouTube アップロードワーカー（Sprint B）
 *
 * Vercel Cron から 5 分間隔で叩かれる。
 * 1 tick = 1 broadcast の処理（quota 1 日 6 件制限を考えると並列化不要）。
 *
 * 処理フロー:
 *   1. youtube_upload_status='pending' を 1 件 SELECT
 *      （retry_count 少ない順 / 古い順で公平に処理）
 *   2. 楽観排他 UPDATE で 'uploading' にマーク（他 tick が先取り済みなら諦める）
 *   3. Supabase Storage から MP4 ダウンロード（B2）
 *   4. アクセストークン refresh（必要なら、B3）
 *   5. YouTube に unlisted アップロード（B4）
 *   6. 成功なら youtube_video_id 保存 + Storage MP4 削除（B6）
 *      失敗なら error 分類してリトライ or failed 確定（B5）
 *
 * 現状の本ファイルは B1（ワーカー骨格）まで実装。B2〜B6 の実処理は
 * 後続コミットで `lib/youtube-upload.ts` に追加して、ここから呼び出す。
 */
export async function GET(request: Request) {
  // Vercel Cron 認証（タイミング攻撃対策付き）
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

  // フラグ off の間は何もしない（cron 自体は走るが noop で 200）
  if (!isArchiveEnabled()) {
    return Response.json({ skipped: "archive_disabled" });
  }

  const admin = getAdminClient();

  // pending 1 件を取得。retry_count 少ない順 → completed_at 古い順で公平に処理。
  // youtube_upload_completed_at は失敗時にも更新する設計のため、リトライ対象を
  // 古い順に拾える（null は新規 = 最古扱い）。
  const { data: pending, error: selectErr } = await admin
    .from("broadcasts")
    .select(
      "id, recording_key, recording_file_path, broadcaster_id, " +
        "youtube_retry_count, home_team, away_team, sport, tournament, " +
        "venue, started_at, share_code",
    )
    .eq("youtube_upload_status", "pending")
    .lt("youtube_retry_count", MAX_RETRY)
    .not("recording_key", "is", null)
    .order("youtube_retry_count", { ascending: true })
    .order("youtube_upload_completed_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (selectErr) {
    console.error(
      "[cron/youtube-upload] select pending failed:",
      selectErr.message,
    );
    return Response.json({ error: "DB select failed" }, { status: 500 });
  }

  if (!pending) {
    return Response.json({ processed: 0, message: "no pending uploads" });
  }

  // 楽観排他で 'uploading' にマーク。他 tick が先取り済みなら 0 行更新で諦める。
  // started_at は uploading 突入時刻として記録（cleanup cron が stale 検出に使う）。
  const { data: claimed, error: claimErr } = await admin
    .from("broadcasts")
    .update({
      youtube_upload_status: "uploading",
      youtube_upload_started_at: new Date().toISOString(),
    })
    .eq("id", pending.id)
    .eq("youtube_upload_status", "pending")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    console.error(
      "[cron/youtube-upload] claim failed:",
      claimErr.message,
    );
    return Response.json({ error: "DB claim failed" }, { status: 500 });
  }

  if (!claimed) {
    // 他の tick が先取りした。次の tick で別の pending を拾う（or 同じ broadcast の
    // uploading 完了を待つ）ので noop でよい。
    return Response.json({
      processed: 0,
      skipped: "claimed_by_another_tick",
    });
  }

  console.info("[cron/youtube-upload] claimed broadcast", {
    broadcastId: pending.id,
    retryCount: pending.youtube_retry_count,
  });

  // TODO B2-B6: Storage download → token refresh → YouTube upload → mark completed/failed
  // 本コミット (B1) では claim までで一旦 200 返却。後続コミットで実処理を追加。
  return Response.json({
    processed: 1,
    broadcastId: pending.id,
    status: "uploading",
    todo: "B2-B6 not yet implemented",
  });
}
