import { isBunnyLiveEnabled } from "@/lib/bunny-flag";
import { stopBunnyLiveStream } from "@/lib/bunny-stream";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Bunny 配信プロビジョニング 停止 API。
 *
 * 配信者アプリの「配信終了」時に fire-and-forget で叩く。Bunny LiveStream を停止し、
 * bunny_status を 'ended' に倒す。停止後 recordVod=true なら VOD（→ YouTube アーカイブ）が生成される。
 *
 * 弱電波・二重呼び出しでも UI が回復不能にならないよう、停止失敗でも DB は ended に倒す
 * （残骸ライブは cron cleanup で後追い回収する）。フラグ off / 未開始 / 既停止は 200 noop。
 */
export async function POST(request: Request) {
  if (!isBunnyLiveEnabled()) {
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
    return Response.json({ error: "broadcastId is required" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select("id, broadcaster_id, bunny_video_guid, bunny_status")
    .eq("id", broadcastId)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!broadcast.bunny_video_guid) {
    return Response.json({ skipped: "not-started" });
  }
  if (broadcast.bunny_status === "ended") {
    return Response.json({ skipped: "already-ended" });
  }

  try {
    await stopBunnyLiveStream(broadcast.bunny_video_guid);
  } catch (err) {
    // 停止失敗でも DB は ended にする（cron cleanup が残骸を回収）。
    console.warn(
      "[bunny/stop] stopBunnyLiveStream failed:",
      err instanceof Error ? err.message : err,
    );
  }

  await admin
    .from("broadcasts")
    .update({ bunny_status: "ended" })
    .eq("id", broadcast.id);

  return Response.json({ stopped: true });
}
