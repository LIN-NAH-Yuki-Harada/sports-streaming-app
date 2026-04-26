import { WebhookReceiver } from "livekit-server-sdk";

// livekit-server-sdk の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * LiveKit Egress Webhook ハンドラ（Sprint A1: スケルトン版）
 *
 * LiveKit Cloud から Egress イベント（egress_started / egress_updated /
 * egress_ended）が JWT 署名付きで POST されてくる。WebhookReceiver は
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET で JWT を検証する。
 *
 * Sprint A1 では署名検証してログを吐くだけ。Sprint A3 で egress_ended の時に
 * broadcasts.recording_key / youtube_upload_status='pending' を書き込む実装を載せる。
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

  // Sprint A3 で本実装。今はログのみ。
  console.info(
    "[egress-webhook] received",
    JSON.stringify({
      event: event.event,
      egressId: event.egressInfo?.egressId,
      status: event.egressInfo?.status,
      roomName: event.egressInfo?.roomName,
      fileResults: event.egressInfo?.fileResults?.map((f) => ({
        filename: f.filename,
        size: f.size,
        location: f.location,
      })),
    }),
  );

  return Response.json({ received: true });
}
