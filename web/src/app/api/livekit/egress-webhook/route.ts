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

  // recording_egress_id で broadcasts を引く（旧パイプライン: S3 録画）
  const { data: broadcast } = await admin
    .from("broadcasts")
    .select("id, youtube_upload_status")
    .eq("recording_egress_id", info.egressId)
    .single();

  if (!broadcast) {
    // 旧パイプラインで該当しない場合、新パイプライン（Live 中継 RTMP push）を試す
    const liveResult = await handleLiveEgressEnded(info, admin);
    if (liveResult.handled) {
      return Response.json(liveResult.body);
    }
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

  const updatePayload: Record<string, unknown> = {
    recording_key: recordingKey,
    recording_file_path: recordingFilePath,
    youtube_upload_status: newStatus,
    youtube_upload_completed_at: new Date().toISOString(),
  };
  if (errorMessage) {
    updatePayload.youtube_upload_error = errorMessage.slice(0, 500);
  }

  // CAS ガード: 既に終端 / 進行中の status は上書きしない。
  // - 'cancelled': 配信者が「YouTubeに保存しない」を選んだ意思決定。
  // - 'failed':    start API 等が立てたエラーマーク。
  // - 'uploading': cron が掴んでアップロード中。
  // - 'completed': 既にアップロード完了。
  //
  // 4/29 実機 E2E で、archive-decision API が 'cancelled' を書いた直後に
  // この webhook が古い 'pending' 値を読んで上書きするレース（TOCTOU）が再現。
  // 読み時点でなく書き時点のチェックにすることでアトミックに防ぐ。
  const { error: uErr, count } = await admin
    .from("broadcasts")
    .update(updatePayload, { count: "exact" })
    .eq("id", broadcast.id)
    .not(
      "youtube_upload_status",
      "in",
      "(cancelled,failed,uploading,completed)",
    );

  if (uErr) {
    console.error("[egress-webhook] DB update failed:", uErr.message);
    return Response.json({ error: "DB update failed" }, { status: 500 });
  }

  // CAS で UPDATE が skip された場合（書き時点で既に終端 status）。
  // recording_key/file_path だけは保存して、cleanup cron が
  // cancelled MP4 を削除できるようにする。
  if (count === 0) {
    const kept = broadcast.youtube_upload_status;
    console.warn(
      `[egress-webhook] CAS guard skipped overwrite (kept=${kept})`,
      { broadcastId: broadcast.id, egressId: info.egressId },
    );
    if (recordingKey) {
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

/**
 * 新パイプライン（Live 中継 RTMP push）の egress_ended ハンドリング（PR-3）。
 *
 * live_egress_id でマッチした broadcasts に live_status='ended' / 'failed' と
 * live_ended_at を書き込む。YouTube 側は createLiveBroadcast の
 * enableAutoStop=true により自動で complete に遷移済の想定。
 *
 * 旧パイプラインの recording_egress_id ロジックでマッチしなかった場合のみ
 * 呼ばれる。両パイプラインの egress_id は別カラムに分かれているため衝突しない。
 */
async function handleLiveEgressEnded(
  info: NonNullable<
    Awaited<ReturnType<WebhookReceiver["receive"]>>["egressInfo"]
  >,
  admin: ReturnType<typeof getAdminClient>,
): Promise<{ handled: boolean; body: Record<string, unknown> }> {
  const { data: liveBroadcast } = await admin
    .from("broadcasts")
    .select(
      "id, live_status, live_youtube_broadcast_id, youtube_video_id",
    )
    .eq("live_egress_id", info.egressId)
    .single();

  if (!liveBroadcast) {
    return { handled: false, body: {} };
  }

  const isComplete = info.status === EgressStatus.EGRESS_COMPLETE;
  const newLiveStatus = isComplete ? "ended" : "failed";
  const errorMessage = isComplete
    ? null
    : info.error || `egress ended with status ${info.status}`;

  // YouTube Live broadcast ID を youtube_video_id にコピー（視聴 UI の埋め込み再生用）。
  // YouTube の仕様で broadcast.id = アーカイブ動画の video ID なのでそのまま使える。
  // 旧パイプラインで先に youtube_video_id が入っているケースは並行運用想定外なので上書きせず温存。
  const updatePayload: Record<string, unknown> = {
    live_status: newLiveStatus,
    live_ended_at: new Date().toISOString(),
  };
  if (errorMessage) {
    updatePayload.live_error = errorMessage.slice(0, 500);
  }
  if (
    isComplete &&
    !liveBroadcast.youtube_video_id &&
    liveBroadcast.live_youtube_broadcast_id
  ) {
    updatePayload.youtube_video_id = liveBroadcast.live_youtube_broadcast_id;
  }

  // live/stop API がベストエフォート先回り更新で 'ended' を入れている可能性あり。
  // 二重書き防止のため終端 status は上書きしない CAS ガード。
  const { error: uErr, count } = await admin
    .from("broadcasts")
    .update(updatePayload, { count: "exact" })
    .eq("id", liveBroadcast.id)
    .not("live_status", "in", "(ended,failed)");

  if (uErr) {
    console.error("[egress-webhook] live DB update failed:", uErr.message);
    return {
      handled: true,
      body: { error: "live DB update failed" },
    };
  }

  if (count === 0) {
    console.info(
      `[egress-webhook] live CAS skipped (kept=${liveBroadcast.live_status})`,
      { broadcastId: liveBroadcast.id, egressId: info.egressId },
    );
    return {
      handled: true,
      body: { received: true, kept: liveBroadcast.live_status },
    };
  }

  console.info(
    "[egress-webhook] live processed",
    JSON.stringify({
      broadcastId: liveBroadcast.id,
      egressId: info.egressId,
      liveStatus: newLiveStatus,
      youtubeVideoId: liveBroadcast.live_youtube_broadcast_id,
    }),
  );

  return {
    handled: true,
    body: {
      received: true,
      broadcastId: liveBroadcast.id,
      liveStatus: newLiveStatus,
    },
  };
}
