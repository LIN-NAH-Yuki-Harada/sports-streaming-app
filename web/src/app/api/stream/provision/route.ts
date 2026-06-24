import { isSelfHostStreamEnabled } from "@/lib/stream-flag";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

// crypto/admin client を使うため Node.js 強制（既存ルートと統一）。
export const runtime = "nodejs";

/**
 * 自前配信サーバー（MediaMTX on VPS）向け プロビジョニング API。
 *
 * 配信者アプリが「配信開始」時に叩く。配信先（RTMP・publish認証付）＋視聴URL（HLS）を返す。
 *
 * 戻り値（成功）: { rtmpUrl, playbackUrl, path }
 *   - rtmpUrl  = rtmp://<STREAM_HOST>/<shareCode>?user=<USER>&pass=<SECRET>
 *                （★この完全URLをそのまま RtmpPublisher.streamUrl に渡す）
 *   - playbackUrl = https://<STREAM_HOST>/<shareCode>/index.m3u8（視聴・共有コードで誰でも）
 *
 * 認証モデル: MediaMTX internal auth。視聴(read)は誰でも / 配信(publish)はパスワード必須。
 *   SECRET は MediaMTX 設定と同じ値を Vercel env(STREAM_PUBLISH_SECRET)に置く。
 *   ★ SECRET は DB に保存しない（このレスポンスでのみ配信者アプリに渡す）。
 *
 * 配信の本経路なので、失敗時は 4xx/5xx を返す（LiveKit live/start の noop とは異なる）。
 * フラグ off の間は 503 → アプリは旧 LiveKit 経路に自動フォールバック。
 */
export async function POST(request: Request) {
  // 1. フラグ off → 旧 LiveKit 経路へ（アプリがこの 503 を見てフォールバック）
  if (!isSelfHostStreamEnabled()) {
    return Response.json({ error: "selfhost stream disabled" }, { status: 503 });
  }

  // 2. 認証
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. env
  const host = process.env.STREAM_HOST;
  const secret = process.env.STREAM_PUBLISH_SECRET;
  const pubUser = process.env.STREAM_PUBLISH_USER || "spotch";
  if (!host || !secret) {
    console.error(
      "[stream/provision] env missing: STREAM_HOST / STREAM_PUBLISH_SECRET",
    );
    return Response.json({ error: "stream env missing" }, { status: 500 });
  }

  // 4. body
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

  // 5. 所有権・状態検証（SELECT は単一リテラル）
  const admin = getAdminClient();
  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select("id, share_code, broadcaster_id, status")
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
      { error: "not-live", status: broadcast.status },
      { status: 409 },
    );
  }

  // 6. URL 構築。MediaMTX の path = 共有コード（視聴の公開キー）。
  const path = broadcast.share_code;
  const rtmpUrl = `rtmp://${host}/${path}?user=${encodeURIComponent(pubUser)}&pass=${encodeURIComponent(secret)}`;
  const playbackUrl = `https://${host}/${path}/index.m3u8`;

  // 7. 視聴側が HLS URL を見つけられるよう broadcasts に保存（secret は保存しない）。
  //    自前RTMP経路は端末でスコアを焼き込むため scoreboard_burned_in=true にし、
  //    視聴側 CSS オーバーレイの二重表示を防ぐ。
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({ stream_playback_url: playbackUrl, scoreboard_burned_in: true })
    .eq("id", broadcast.id);
  if (uErr) {
    // 保存失敗でも配信自体は開始できるよう creds は返す（視聴側の解決のみ遅れる）。
    console.error("[stream/provision] DB update failed:", uErr.message);
  }

  return Response.json({ rtmpUrl, playbackUrl, path });
}
