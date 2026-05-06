import { EncodingOptionsPreset } from "livekit-server-sdk";
import { isArchiveEnabled } from "@/lib/archive-flag";
import {
  assertEgressEnv,
  buildRecordingOutput,
  getEgressClient,
} from "@/lib/livekit-egress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

// livekit-server-sdk の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * LiveKit Egress 起動 API（Sprint A2）
 *
 * 配信者のクライアントが LiveKit Cloud に接続成功した直後（onConnected）に
 * fire-and-forget で叩く。「録画してね」と LiveKit Cloud のサーバーに依頼し、
 * 結果 MP4 を Supabase Storage に書かせる。配信者の端末は何も負担しない。
 *
 * フラグ off / ユーザー設定 off / 既起動 / 配信終了済み のケースは
 * すべて 200 で noop 返却。**4xx は返さない**（クライアント側の毎回 try/catch を
 * 不要にし、フラグ on/off の切替で UX が変わらないようにする）。
 */
export async function POST(request: Request) {
  // 1. フラグ off → 即終了（本番デフォルト動作）
  if (!isArchiveEnabled()) {
    return Response.json({ skipped: "flag-off" });
  }

  // 2. 認証
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. 必須 env チェック（足りなければ 500）
  try {
    assertEgressEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : "env error";
    console.error("[egress/start]", message);
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
  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, status, recording_egress_id",
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
      { skipped: "not-live", status: broadcast.status },
    );
  }

  // 6. 既に起動済みなら冪等で reuse（ネットワーク再接続で二度叩かれた等）
  if (broadcast.recording_egress_id) {
    return Response.json({ reused: broadcast.recording_egress_id });
  }

  // 7. profile.youtube_auto_archive が false なら録画スキップ
  const { data: profile } = await admin
    .from("profiles")
    .select("youtube_auto_archive")
    .eq("id", user.id)
    .single();
  if (profile?.youtube_auto_archive === false) {
    return Response.json({ skipped: "user-disabled" });
  }

  // 8. Egress 起動
  let egressId: string;
  try {
    const output = buildRecordingOutput(broadcast.share_code, broadcast.id);
    const info = await getEgressClient().startRoomCompositeEgress(
      broadcast.share_code,
      output,
      {
        layout: "speaker",
        // 5/06: 配信側 720p 統一に合わせて録画 Egress も 720p に揃える。
        // 配信側 720p × Egress 1080p 出力は仮想 Chrome のアップスケール
        // 限界で品質改善せず、無駄に bitrate を消費するだけだった。
        encodingOptions: EncodingOptionsPreset.H264_720P_30,
        audioOnly: false,
        videoOnly: false,
      },
    );
    egressId = info.egressId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[egress/start] startRoomCompositeEgress failed:", message);
    // 失敗を DB にマークして次回 cron で観測可能にする
    await admin
      .from("broadcasts")
      .update({
        youtube_upload_status: "failed",
        youtube_upload_error: message.slice(0, 500),
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "Egress start failed", message },
      { status: 500 },
    );
  }

  // 9. DB に記録
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({
      recording_egress_id: egressId,
      youtube_upload_status: "recording",
      youtube_upload_started_at: new Date().toISOString(),
    })
    .eq("id", broadcast.id);
  if (uErr) {
    console.error("[egress/start] DB update failed:", uErr.message);
    // Egress は走り出してしまったので、cron 側で recording_egress_id 無し+
    // active な egress を回収する仕組みは Sprint A3 で webhook 経由 or 別 cron で対応
    return Response.json({ egressId, dbUpdateFailed: true });
  }

  return Response.json({ egressId });
}
