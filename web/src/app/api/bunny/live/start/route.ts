import { isBunnyLiveEnabled } from "@/lib/bunny-flag";
import {
  assertBunnyEnv,
  createBunnyLiveStream,
  deleteBunnyLiveStream,
} from "@/lib/bunny-stream";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

// fetch ベースだが Bunny の AccessKey 秘密を Edge に出さないため Node.js 強制（既存ルートと統一）。
export const runtime = "nodejs";

/**
 * Bunny 配信プロビジョニング 開始 API。
 *
 * 配信者アプリ（ネイティブ RTMP）が「配信開始」時に叩く。Bunny LiveStream を発行し、
 * RTMP 取り込み先 + stream key + HLS 再生 URL を返す。
 *
 * 戻り値（成功）: { rtmpUrl, streamKey, playbackUrl, bunnyVideoGuid }
 *   ★ アプリ側で完全 RTMP URL = `${rtmpUrl}/${streamKey}` を**結合**して RtmpPublisher に渡す。
 *      （streamKey を DB/ログに残さないため分離して返す）
 *
 * LiveKit live/start（YouTube 用・全 200 noop）とは異なり、これは配信の本経路なので
 * 失敗時はちゃんと 4xx/5xx を返す（アプリが配信開始の可否を判断できるように）。
 *
 * ⚠️ 本番点灯順序: ①migration（bunny_* 列）適用 → ②env 設定 → ③NEXT_PUBLIC_BUNNY_LIVE=true。
 *    フラグ off の間はこのルートは 503 を返すだけで、bunny_* 列を SELECT/UPDATE しない。
 */
export async function POST(request: Request) {
  // 1. フラグ off → 配信元は旧 LiveKit 経路。アプリはこの 503 を見て従来経路にフォールバック。
  if (!isBunnyLiveEnabled()) {
    return Response.json({ error: "Bunny disabled" }, { status: 503 });
  }

  // 2. 認証
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. env チェック
  try {
    assertBunnyEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : "env error";
    console.error("[bunny/start]", message);
    return Response.json({ error: "Bunny env missing" }, { status: 500 });
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
    return Response.json({ error: "broadcastId is required" }, { status: 400 });
  }

  const admin = getAdminClient();

  // 5. broadcasts を引いて所有権・状態を検証（SELECT は単一リテラル）
  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, status, home_team, away_team, bunny_video_guid",
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
    return Response.json(
      { error: "not-live", status: broadcast.status },
      { status: 409 },
    );
  }

  // 6. 旧プロビジョニングが残っていれば best-effort で破棄（孤児 Bunny リソース防止）。
  //    await しない（再発行を遅らせない・失敗しても続行）。
  if (broadcast.bunny_video_guid) {
    deleteBunnyLiveStream(broadcast.bunny_video_guid).catch((e) =>
      console.warn(
        "[bunny/start] stale stream delete failed:",
        e instanceof Error ? e.message : e,
      ),
    );
  }

  // 7. Bunny LiveStream を作成
  let stream;
  try {
    stream = await createBunnyLiveStream(
      `${broadcast.home_team} vs ${broadcast.away_team} (${broadcast.share_code})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[bunny/start] createBunnyLiveStream failed:", message);
    await admin
      .from("broadcasts")
      .update({ bunny_status: "failed" })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "Bunny live create failed", message },
      { status: 502 },
    );
  }

  // 8. DB に記録（streamKey と完全 RTMP URL は保存しない）
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({
      bunny_video_guid: stream.guid,
      bunny_playback_url: stream.playbackUrl,
      bunny_status: "creating",
    })
    .eq("id", broadcast.id);
  if (uErr) {
    // 記録失敗でも配信自体は開始できるよう creds は返す（視聴側の再生 URL 解決のみ遅れる）。
    console.error("[bunny/start] DB update failed:", uErr.message);
  }

  return Response.json({
    rtmpUrl: stream.rtmpIngestUrl,
    streamKey: stream.streamKey,
    playbackUrl: stream.playbackUrl,
    bunnyVideoGuid: stream.guid,
  });
}
