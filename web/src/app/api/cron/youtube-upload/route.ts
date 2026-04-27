import { timingSafeEqual } from "node:crypto";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { getAdminClient } from "@/lib/supabase-admin";
import {
  classifyError,
  deleteRecording,
  downloadRecording,
  getOAuthClientForProfile,
  markCompleted,
  markFailed,
  markPendingForRetry,
  uploadToYouTube,
  type YoutubeProfile,
} from "@/lib/youtube-upload";

// googleapis / Supabase Storage SDK が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

// アップロード失敗の最大リトライ回数。これを超えたら failed に確定する。
// cron 5 分間隔なので、完全失敗まで最大 25 分 (5 attempt × 5 分)。
const MAX_RETRY = 5;

/**
 * YouTube アップロードワーカー（Sprint B）
 *
 * Vercel Cron から 1 日 1 回叩かれる。
 *
 * NOTE: Vercel Hobby プラン制限により、現状は schedule="0 0 * * *" (daily)。
 * 本番フラグ ON のタイミングで Vercel Pro ($20/月) に昇格し、vercel.json の
 * schedule を "*\/5 * * * *" (5 分間隔) に戻す予定（feedback_vercel_hobby_cron.md）。
 * フラグ OFF 期間中はそもそも cron が走っても skipped 返却なので daily で問題ない。
 *
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
  const { data: pendingRaw, error: selectErr } = await admin
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

  if (!pendingRaw) {
    return Response.json({ processed: 0, message: "no pending uploads" });
  }

  // Supabase の .select(列リスト文字列) は戻り値型が GenericStringError 寄りに
  // ドリフトすることがあるため、ここで明示型キャストする
  // (feedback_pr_local_build_required.md の確立パターン)。
  const pending = pendingRaw as unknown as {
    id: string;
    recording_key: string | null;
    recording_file_path: string | null;
    broadcaster_id: string;
    youtube_retry_count: number | null;
    home_team: string;
    away_team: string;
    sport: string;
    tournament: string | null;
    venue: string | null;
    started_at: string | null;
    share_code: string;
  };

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

  const retryCount = pending.youtube_retry_count ?? 0;

  // recording_key が null の場合は致命的 (Sprint A の webhook がうまく動かなかった)。
  // pending 取得時に not null フィルタしているので通常はここには来ないが防衛的に確認。
  if (!pending.recording_key) {
    await markFailed({
      broadcastId: pending.id,
      errorMessage: "recording_key is null (Egress webhook may have failed)",
      retryCount,
    });
    return Response.json({
      processed: 1,
      broadcastId: pending.id,
      status: "failed",
      reason: "no_recording_key",
    });
  }

  // 配信者の YouTube OAuth トークンを profile から取得 (service_role 経由なので
  // 機密列も読める)。
  const { data: profileRaw, error: profileErr } = await admin
    .from("profiles")
    .select("id, youtube_access_token, youtube_refresh_token")
    .eq("id", pending.broadcaster_id)
    .single();

  if (profileErr || !profileRaw) {
    await markFailed({
      broadcastId: pending.id,
      errorMessage: `broadcaster profile lookup failed: ${profileErr?.message ?? "no row"}`,
      retryCount,
    });
    return Response.json({
      processed: 1,
      broadcastId: pending.id,
      status: "failed",
      reason: "profile_not_found",
    });
  }

  const profile = profileRaw as unknown as YoutubeProfile;

  try {
    // 1. Storage から MP4 ダウンロード
    const buffer = await downloadRecording(pending.recording_key);

    // 2. OAuth client 準備 (期限切れなら refresh + DB 書き戻し)
    const oauth2Client = await getOAuthClientForProfile(profile);

    // 3. YouTube に unlisted アップロード
    const videoId = await uploadToYouTube(
      buffer,
      {
        homeTeam: pending.home_team,
        awayTeam: pending.away_team,
        sport: pending.sport,
        tournament: pending.tournament,
        venue: pending.venue,
        startedAt: pending.started_at,
        shareCode: pending.share_code,
      },
      oauth2Client,
    );

    // 4. completed をマーク (Realtime で UI に通知される)
    await markCompleted({ broadcastId: pending.id, videoId });

    // 5. Storage MP4 削除 (best-effort、失敗しても warn のみ)
    await deleteRecording(pending.recording_key);

    console.info("[cron/youtube-upload] upload completed", {
      broadcastId: pending.id,
      youtubeVideoId: videoId,
    });

    return Response.json({
      processed: 1,
      broadcastId: pending.id,
      status: "completed",
      youtubeVideoId: videoId,
    });
  } catch (err) {
    const classified = classifyError(err);
    console.error("[cron/youtube-upload] upload failed", {
      broadcastId: pending.id,
      type: classified.type,
      status: classified.status,
      message: classified.message,
    });

    // retry / auth-refresh は max に達していなければ pending に戻す
    // (auth-refresh は次回 tick で getOAuthClientForProfile が refresh するので
    //  その時点で通る可能性あり)
    const isRetryable =
      classified.type === "retry" || classified.type === "auth-refresh";
    if (isRetryable && retryCount < MAX_RETRY - 1) {
      await markPendingForRetry({
        broadcastId: pending.id,
        currentRetryCount: retryCount,
        errorMessage: classified.message,
      });
      return Response.json({
        processed: 1,
        broadcastId: pending.id,
        status: "pending_retry",
        retryCount: retryCount + 1,
        type: classified.type,
      });
    }

    // fatal / token-revoked / max retry over → failed 確定
    await markFailed({
      broadcastId: pending.id,
      errorMessage:
        classified.type === "token-revoked"
          ? `${classified.message} (再連携が必要です)`
          : classified.message,
      retryCount,
    });
    return Response.json({
      processed: 1,
      broadcastId: pending.id,
      status: "failed",
      type: classified.type,
    });
  }
}
