import { WebhookReceiver } from "livekit-server-sdk";
import { EgressStatus } from "@livekit/protocol";
import { getAdminClient } from "@/lib/supabase-admin";

// livekit-server-sdk の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * LiveKit Egress Webhook ハンドラ（Sprint A3: 本実装）
 *
 * LiveKit Cloud から Egress イベント（egress_started / egress_updated /
 * egress_ended）が JWT 署名付きで POST されてくる。WebhookReceiver は
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET で JWT を検証する。
 *
 * egress_ended 受信時:
 *   - recording_key / recording_file_path を FileInfo から保存
 *     （クライアント側の予測値はミリ秒ズレで信頼できないため、サーバーが
 *      実際に書き込んだファイル名を「正」として保存する）
 *   - 成功なら youtube_upload_status='pending'（Sprint B のアップロードワーカー待ち）
 *   - 失敗なら youtube_upload_status='failed' + youtube_upload_error
 *
 * フラグ NEXT_PUBLIC_ARCHIVE_ENABLED が false でも 200 を返す。4xx を返すと
 * LiveKit が指数バックオフでリトライしてダッシュボードのエラーグラフを汚すため。
 */
export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.error("[egress-webhook] LiveKit credentials missing");
    return new Response("Server misconfigured", { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  // raw body を取得（WebhookReceiver は文字列で署名検証する。
  // request.json() を呼ぶと body が消費されて検証できなくなる）
  const body = await request.text();

  const receiver = new WebhookReceiver(apiKey, apiSecret);
  let event;
  try {
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[egress-webhook] signature verification failed:", message);
    return new Response("Unauthorized", { status: 401 });
  }

  // egress_ended 以外（egress_started / egress_updated）はログのみ
  if (event.event !== "egress_ended" || !event.egressInfo) {
    console.info(
      "[egress-webhook] event=",
      event.event,
      "egressId=",
      event.egressInfo?.egressId,
      "status=",
      event.egressInfo?.status,
    );
    return Response.json({ received: true });
  }

  const info = event.egressInfo;
  const admin = getAdminClient();

  // recording_egress_id で broadcasts を引く
  const { data: broadcast } = await admin
    .from("broadcasts")
    .select("id, youtube_upload_status")
    .eq("recording_egress_id", info.egressId)
    .single();

  if (!broadcast) {
    // フラグ off 期間にテスト起動した残骸 / 別環境の Egress 等。素通り。
    console.info(
      "[egress-webhook] broadcast not found for egressId=",
      info.egressId,
    );
    return Response.json({ received: true });
  }

  // FileInfo から実際の出力ファイル情報を取得（サーバー側の正値）
  const fileResult = info.fileResults?.[0];
  const recordingKey = fileResult?.filename ?? null;
  const recordingFilePath = fileResult?.location ?? null;
  const fileSize = fileResult?.size ? Number(fileResult.size) : null; // bigint → number

  const isComplete = info.status === EgressStatus.EGRESS_COMPLETE;
  const newStatus = isComplete ? "pending" : "failed"; // pending = Sprint B のアップロード待ち
  const errorMessage = isComplete
    ? null
    : info.error || `egress ended with status ${info.status}`;

  // 既存の最終状態（'failed' / 'cancelled'）は上書きしない。
  // - 'failed': start API での失敗マーク等を保護
  // - 'cancelled': 配信者が「YouTubeに保存しない」を選択した意思決定を保護
  //   （webhook が後で完了通知してきても pending に戻さない）
  if (
    (broadcast.youtube_upload_status === "failed" ||
      broadcast.youtube_upload_status === "cancelled") &&
    isComplete
  ) {
    const kept = broadcast.youtube_upload_status;
    console.warn(
      `[egress-webhook] keeping existing '${kept}' status, not overwriting to pending`,
      { broadcastId: broadcast.id, egressId: info.egressId },
    );
    // recording_key/file_path だけは保存（cleanup cron が cancelled の MP4 削除に使う）
    if (kept === "cancelled" && recordingKey) {
      await admin
        .from("broadcasts")
        .update({
          recording_key: recordingKey,
          recording_file_path: recordingFilePath,
        })
        .eq("id", broadcast.id);
    }
    return Response.json({ received: true, kept });
  }

  const updatePayload: Record<string, unknown> = {
    recording_key: recordingKey,
    recording_file_path: recordingFilePath,
    youtube_upload_status: newStatus,
    youtube_upload_completed_at: new Date().toISOString(),
  };
  if (errorMessage) {
    updatePayload.youtube_upload_error = errorMessage.slice(0, 500);
  }

  const { error: uErr } = await admin
    .from("broadcasts")
    .update(updatePayload)
    .eq("id", broadcast.id);

  if (uErr) {
    console.error("[egress-webhook] DB update failed:", uErr.message);
    return Response.json({ error: "DB update failed" }, { status: 500 });
  }

  console.info(
    "[egress-webhook] processed",
    JSON.stringify({
      broadcastId: broadcast.id,
      egressId: info.egressId,
      status: newStatus,
      recordingKey,
      fileSize,
    }),
  );

  return Response.json({
    received: true,
    broadcastId: broadcast.id,
    status: newStatus,
  });
}
