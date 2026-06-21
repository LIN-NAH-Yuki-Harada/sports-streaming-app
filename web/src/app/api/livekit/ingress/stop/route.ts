import { deleteBroadcastIngress } from "@/lib/livekit-ingress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * RTMP Ingress 停止 API
 *
 * 配信終了時にアプリから叩く想定。LiveKit の Ingress を破棄して取り込み口を閉じ、
 * broadcasts.live_ingress_id をクリアする。
 *
 * Ingress を消し忘れても課金は media が流れている間の transcode minutes のみで、
 * push が止まれば実質停止する。残骸はゴースト掃除 cron / 次回 start 時の作り直しで回収。
 *
 * 未起動 / 既停止のケースは 200 で noop。
 */
export async function POST(request: Request) {
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
    .select("id, broadcaster_id, live_ingress_id")
    .eq("id", broadcastId)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!broadcast.live_ingress_id) {
    return Response.json({ skipped: "not-started" });
  }

  try {
    await deleteBroadcastIngress(broadcast.live_ingress_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ingress/stop] deleteBroadcastIngress failed:", message);
    // 破棄失敗でも DB はクリアして UI を回復可能にする（残骸は cron で回収）
  }

  await admin
    .from("broadcasts")
    .update({ live_ingress_id: null })
    .eq("id", broadcast.id);

  return Response.json({ stopped: true });
}
