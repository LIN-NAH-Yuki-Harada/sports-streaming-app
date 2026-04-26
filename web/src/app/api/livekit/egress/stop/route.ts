import { isArchiveEnabled } from "@/lib/archive-flag";
import { getEgressClient } from "@/lib/livekit-egress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * LiveKit Egress 停止 API（Sprint A2）
 *
 * 配信終了時に呼ばれる。LiveKit Cloud に「録画終わり」と伝えると、Egress は
 * 出力ファイルを S3 にアップロード完了させてから停止する。停止完了は webhook
 * の egress_ended で受信し、そこで DB を更新する（このルートでは DB を触らない）。
 *
 * 既に LiveKit が room_finished 検知で勝手に停止済みのことがあるので、
 * stopEgress の例外は握りつぶす（成功扱いで返す）。
 */
export async function POST(request: Request) {
  if (!isArchiveEnabled()) {
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

  const { data: broadcast } = await admin
    .from("broadcasts")
    .select("id, broadcaster_id, recording_egress_id")
    .eq("id", broadcastId)
    .single();

  if (!broadcast) {
    return Response.json({ skipped: "not-found" });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!broadcast.recording_egress_id) {
    return Response.json({ skipped: "no-egress" });
  }

  // stopEgress は LiveKit 側で既に終了済みでも例外を投げる場合があるため握りつぶす
  try {
    await getEgressClient().stopEgress(broadcast.recording_egress_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "stop failed";
    console.warn(
      "[egress/stop] stopEgress threw (likely already-ended):",
      message,
    );
  }

  return Response.json({ stopped: broadcast.recording_egress_id });
}
