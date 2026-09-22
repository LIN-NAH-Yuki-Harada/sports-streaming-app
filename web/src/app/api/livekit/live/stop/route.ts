import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import {
  buildSelfHostPlaybackUrl,
  stopRtmpEgress,
} from "@/lib/livekit-rtmp-egress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Live 中継停止 API（PR-3）
 *
 * 配信者が「配信終了」ボタンを押した時に呼ばれる想定。LiveKit Egress を
 * 停止し、broadcasts.live_status を 'ended' にマークする。
 *
 * 停止後の YouTube 側は createLiveBroadcast で enableAutoStop=true にしているため、
 * RTMP 切断検知後に YouTube が自動で broadcast を complete に遷移し、
 * その時点でアーカイブ動画（unlisted）がチャンネルに生成される。
 *
 * 万が一 enableAutoStop が動かない場合の救済として、live/start 側と同じく
 * transitionToComplete を呼ぶ余地はあるが、PR-3 では auto に任せる。
 * 必要なら別 PR でフォローアップ cron を追加。
 *
 * フラグ off / 既停止 / 未起動 のケースは 200 で noop。
 */
export async function POST(request: Request) {
  if (!isLiveArchiveEnabled()) {
    return Response.json({ skipped: "flag-off" });
  }

  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, live_egress_id, live_status, stream_playback_url",
    )
    .eq("id", broadcastId)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!broadcast.live_egress_id) {
    return Response.json({ skipped: "not-started" });
  }
  if (broadcast.live_status === "ended" || broadcast.live_status === "failed") {
    return Response.json({ skipped: "already-ended", status: broadcast.live_status });
  }

  // ★ここが「ブラウザ配信のアーカイブ」の入口（2026-09-23）。
  //
  //   stream_playback_url は3つの役目を兼ねている列で、
  //     1. archive-worker の取得条件（`IS NOT NULL` かつ status='ended'）
  //     2. 視聴ページの経路選択（立っていると HLS を優先する）
  //     3. ghost sweep の対象条件（status='live' かつ非 null）
  //   このうち**欲しいのは 1 だけ**。配信中に立てると 2 で視聴が
  //   LiveKit（ほぼ実時間）から HLS（約11秒遅延）に退行し、
  //   3 で自前 push が落ちただけの配信を強制終了しかねない。
  //
  //   そこで**終了するこの瞬間にだけ**書く。2 は `isLive` 条件付きなので
  //   終了後は参照されず、3 は status='live' が条件なので永久に一致しない。
  //
  //   なお live/start 側の push が自前サーバーに繋がらなかった場合、ここで印を
  //   付けても録画が無い。その場合 worker は "recording not found" を残して
  //   終わる（落ちない）。**それ自体が自前 push の失敗を知らせる信号**になる。
  const playbackUrl = broadcast.stream_playback_url
    ? null
    : buildSelfHostPlaybackUrl(broadcast.share_code);
  const archivePatch = playbackUrl ? { stream_playback_url: playbackUrl } : {};

  try {
    await stopRtmpEgress(broadcast.live_egress_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/stop] stopRtmpEgress failed:", message);
    // 停止失敗でも DB 上は ended 扱いにしないと UI が回復不能になる。
    // 実態としては LiveKit 側で残骸 egress が残るが webhook でいずれ拾える。
    await admin
      .from("broadcasts")
      .update({
        live_status: "failed",
        live_ended_at: new Date().toISOString(),
        live_error: message.slice(0, 500),
        // 停止に失敗しても、自前サーバー側の録画は残っている。
        // アーカイブの取りこぼしを作らないよう、ここでも必ず印を付ける。
        ...archivePatch,
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "Egress stop failed", message },
      { status: 500 },
    );
  }

  // egress_ended webhook 受信時に live_status='ended' + live_ended_at を確定する。
  // ここではベストエフォートで先回り更新（webhook 遅延時の UI 状態確保）。
  await admin
    .from("broadcasts")
    .update({
      live_status: "ended",
      live_ended_at: new Date().toISOString(),
      ...archivePatch,
    })
    .eq("id", broadcast.id);

  return Response.json({
    stopped: true,
    egressId: broadcast.live_egress_id,
    archiveQueued: Object.keys(archivePatch).length > 0,
  });
}
