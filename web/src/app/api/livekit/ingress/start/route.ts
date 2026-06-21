import {
  createBroadcastIngress,
  deleteBroadcastIngress,
} from "@/lib/livekit-ingress";
import { assertRtmpEgressEnv } from "@/lib/livekit-egress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

// livekit-server-sdk の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * RTMP Ingress 起動 API（ネイティブ高画質化の本命経路）
 *
 * スマホ（ネイティブアプリ）が WebRTC ではなく **RTMP で push** して配信ルームに
 * 映像を入れるための取り込み口を作成し、push 先（rtmpUrl + streamKey）を返す。
 * RTMP は TCP バッファ型のため 4G 上りでも安定して高画質を通せる。
 *
 * 配信開始時（broadcast 行作成後）にアプリから叩く想定。YouTube/Egress とは
 * 独立した「配信そのものの経路」なので、live/start（YouTube）とは別エンドポイント。
 *
 * 返却した streamKey は DB に保存しない（YouTube key と同じ扱い）。破棄に使う
 * ingressId だけ broadcasts.live_ingress_id に保存する。
 *
 * 冪等性: 既に live_ingress_id がある場合は古い Ingress を破棄してから作り直す
 * （再接続・再起動で stream key を取り直せるようにする）。
 */
export async function POST(request: Request) {
  // 1. 認証
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. LiveKit env チェック
  try {
    assertRtmpEgressEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : "env error";
    console.error("[ingress/start]", message);
    return Response.json({ error: "LiveKit env missing" }, { status: 500 });
  }

  // 3. body から broadcastId
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

  // 4. broadcasts を引いて所有権・状態を検証
  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select("id, share_code, broadcaster_id, status, live_ingress_id")
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

  // 5. 既存 Ingress があれば破棄してから作り直す（stream key 再取得のため）
  if (broadcast.live_ingress_id) {
    try {
      await deleteBroadcastIngress(broadcast.live_ingress_id);
    } catch (err) {
      // 既に消えている等は無視（クリーンアップはベストエフォート）
      console.warn(
        "[ingress/start] stale ingress delete failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 6. RTMP Ingress 作成（roomName = share_code）
  let ingress: { ingressId: string; rtmpUrl: string; streamKey: string };
  try {
    ingress = await createBroadcastIngress(
      broadcast.share_code,
      `rtmp-ingress-${broadcast.id}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ingress/start] createBroadcastIngress failed:", message);
    return Response.json({ error: "Ingress start failed", message }, { status: 500 });
  }

  // 7. ingressId を保存（stream key は保存しない）
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({ live_ingress_id: ingress.ingressId })
    .eq("id", broadcast.id);
  if (uErr) {
    console.error("[ingress/start] DB update failed:", uErr.message);
    // DB 保存に失敗しても push 自体は可能なので creds は返す（破棄は webhook/cron 救済）
  }

  // 8. アプリへ push 先を返す
  return Response.json({
    ingressId: ingress.ingressId,
    rtmpUrl: ingress.rtmpUrl,
    streamKey: ingress.streamKey,
    roomName: broadcast.share_code,
  });
}
