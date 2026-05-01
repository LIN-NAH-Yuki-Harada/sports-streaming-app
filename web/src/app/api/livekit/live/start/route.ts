import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import {
  bindBroadcastToStream,
  createLiveBroadcast,
  createLiveStream,
  transitionToComplete,
} from "@/lib/youtube-live";
import { getOAuthClientForProfile } from "@/lib/youtube-upload";
import { startRtmpEgress } from "@/lib/livekit-rtmp-egress";
import { assertEgressEnv } from "@/lib/livekit-egress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

// livekit-server-sdk / googleapis の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * Live 中継開始 API（PR-3）
 *
 * 配信者のクライアントが LiveKit に接続成功した直後（onConnected）に
 * fire-and-forget で叩く想定。新パイプライン（YouTube Live RTMP push）の起動口。
 *
 * 起動シーケンス:
 *   1. YouTube に LiveBroadcast 作成（タイトル / 説明 / privacy 設定）
 *   2. YouTube に LiveStream 作成（rtmp ingest URL + stream key 取得）
 *   3. broadcast に stream を bind
 *   4. LiveKit Egress を RTMP push で起動 → 配信ルーム → YouTube Live ingest
 *   5. broadcasts に live_egress_id / live_youtube_broadcast_id /
 *      live_youtube_stream_id / live_status='creating' を保存
 *
 * フラグ off / ユーザー設定 off / 既起動 / 配信終了済み のケースは
 * すべて 200 で noop 返却。**4xx は返さない**（クライアント側の毎回 try/catch を
 * 不要にし、フラグ on/off の切替で UX が変わらないようにする）。
 *
 * 呼び出し側（broadcast/page.tsx）の改修は PR-4 で対応。
 */
export async function POST(request: Request) {
  // 1. フラグ off → 即終了（本番デフォルト動作）
  if (!isLiveArchiveEnabled()) {
    return Response.json({ skipped: "flag-off" });
  }

  // 2. 認証
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. LiveKit env チェック（YouTube 系 env は getOAuthClientForProfile 内部で検証）
  try {
    assertEgressEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : "env error";
    console.error("[live/start]", message);
    return Response.json({ error: "Egress env missing" }, { status: 500 });
  }

  // 4. body から broadcastId
  let broadcastId: string | undefined;
  try {
    const body = (await request.json()) as { broadcastId?: string };
    broadcastId = body.broadcastId;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!broadcastId) {
    return Response.json(
      { error: "broadcastId is required" },
      { status: 400 },
    );
  }

  const admin = getAdminClient();

  // 5. broadcasts を引いて所有権・状態を検証
  // SELECT 文字列は連結せず単一リテラルにする（supabase-js の型推論が template literal で動くため）
  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, status, sport, home_team, away_team, tournament, venue, started_at, live_egress_id",
    )
    .eq("id", broadcastId)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (broadcast.status !== "live") {
    return Response.json({ skipped: "not-live", status: broadcast.status });
  }

  // 6. 既に起動済みなら冪等で reuse（再接続で二度叩かれた等）
  if (broadcast.live_egress_id) {
    return Response.json({ reused: broadcast.live_egress_id });
  }

  // 7. profile を引いて Live 中継 opt-in と OAuth トークンを確認
  const { data: profile } = await admin
    .from("profiles")
    .select(
      "id, youtube_access_token, youtube_refresh_token, youtube_live_enabled, youtube_live_privacy",
    )
    .eq("id", user.id)
    .single();

  if (!profile) {
    return Response.json({ skipped: "profile-not-found" });
  }
  if (profile.youtube_live_enabled === false) {
    return Response.json({ skipped: "user-disabled" });
  }
  if (!profile.youtube_refresh_token) {
    return Response.json({ skipped: "youtube-not-linked" });
  }

  // 8. OAuth client 構築（refresh で access_token 自動更新）
  let oauth2Client;
  try {
    oauth2Client = await getOAuthClientForProfile({
      id: profile.id,
      youtube_access_token: profile.youtube_access_token,
      youtube_refresh_token: profile.youtube_refresh_token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth error";
    console.error("[live/start] OAuth refresh failed:", message);
    return Response.json(
      { error: "OAuth refresh failed", message },
      { status: 500 },
    );
  }

  const privacy: "unlisted" | "private" | "public" =
    profile.youtube_live_privacy === "private" ||
    profile.youtube_live_privacy === "public"
      ? profile.youtube_live_privacy
      : "unlisted";

  // 9. YouTube Live broadcast 作成
  let liveBroadcastId: string;
  try {
    const result = await createLiveBroadcast(
      {
        homeTeam: broadcast.home_team,
        awayTeam: broadcast.away_team,
        sport: broadcast.sport,
        tournament: broadcast.tournament,
        venue: broadcast.venue,
        scheduledStartAt: broadcast.started_at,
        shareCode: broadcast.share_code,
        privacy,
      },
      oauth2Client,
    );
    liveBroadcastId = result.broadcastId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/start] createLiveBroadcast failed:", message);
    await admin
      .from("broadcasts")
      .update({
        live_status: "failed",
        live_error: message.slice(0, 500),
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "YouTube broadcast create failed", message },
      { status: 500 },
    );
  }

  // 10. YouTube Live stream 作成（rtmp URL + stream key 取得）
  let streamId: string;
  let rtmpUrl: string;
  let streamKey: string;
  try {
    const result = await createLiveStream(
      `${broadcast.home_team} vs ${broadcast.away_team} (${broadcast.share_code})`,
      oauth2Client,
    );
    streamId = result.streamId;
    rtmpUrl = result.rtmpUrl;
    streamKey = result.streamKey;
  } catch (err) {
    // broadcast を作って stream で失敗 → broadcast を complete してクリーンアップ
    await safeTransitionToComplete(liveBroadcastId, oauth2Client);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/start] createLiveStream failed:", message);
    await admin
      .from("broadcasts")
      .update({
        live_status: "failed",
        live_error: message.slice(0, 500),
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "YouTube stream create failed", message },
      { status: 500 },
    );
  }

  // 11. broadcast ⇔ stream を bind
  try {
    await bindBroadcastToStream(liveBroadcastId, streamId, oauth2Client);
  } catch (err) {
    await safeTransitionToComplete(liveBroadcastId, oauth2Client);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/start] bindBroadcastToStream failed:", message);
    await admin
      .from("broadcasts")
      .update({
        live_status: "failed",
        live_error: message.slice(0, 500),
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "YouTube bind failed", message },
      { status: 500 },
    );
  }

  // 12. LiveKit Egress を RTMP push で起動
  let egressId: string;
  try {
    egressId = await startRtmpEgress(broadcast.share_code, rtmpUrl, streamKey);
  } catch (err) {
    await safeTransitionToComplete(liveBroadcastId, oauth2Client);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/start] startRtmpEgress failed:", message);
    await admin
      .from("broadcasts")
      .update({
        live_status: "failed",
        live_error: message.slice(0, 500),
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "Egress start failed", message },
      { status: 500 },
    );
  }

  // 13. DB に記録（stream key は保存しない）
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({
      live_egress_id: egressId,
      live_youtube_broadcast_id: liveBroadcastId,
      live_youtube_stream_id: streamId,
      live_status: "creating",
    })
    .eq("id", broadcast.id);
  if (uErr) {
    console.error("[live/start] DB update failed:", uErr.message);
    return Response.json({
      egressId,
      liveBroadcastId,
      streamId,
      dbUpdateFailed: true,
    });
  }

  return Response.json({
    egressId,
    liveBroadcastId,
    streamId,
  });
}

/**
 * クリーンアップ用の transitionToComplete 呼出ラッパ。
 * complete 自体が失敗しても呼出元の元エラーで返したいので warn のみ。
 */
async function safeTransitionToComplete(
  broadcastId: string,
  oauth2Client: Parameters<typeof transitionToComplete>[1],
): Promise<void> {
  try {
    await transitionToComplete(broadcastId, oauth2Client);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    console.warn(
      `[live/start] cleanup transitionToComplete failed for ${broadcastId}:`,
      message,
    );
  }
}
