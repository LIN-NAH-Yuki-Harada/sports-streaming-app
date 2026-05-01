import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import { stopRtmpEgress } from "@/lib/livekit-rtmp-egress";
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
    .select("id, broadcaster_id, live_egress_id, live_status")
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
    })
    .eq("id", broadcast.id);

  return Response.json({ stopped: true, egressId: broadcast.live_egress_id });
}
