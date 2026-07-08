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
 *   - rtmpUrl  = rtmp://<STREAM_HOST>/live/<shareCode>?user=<USER>&pass=<SECRET>
 *                （★この完全URLをそのまま RtmpPublisher.streamUrl に渡す。2要素パス必須＝下記参照）
 *   - playbackUrl = https://<STREAM_HOST>/live/<shareCode>/index.m3u8（視聴・共有コードで誰でも）
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
  // ★ .trim() 必須: Vercel env に値を貼る際、前後に空白/改行が混入しやすい。
  //    host に空白が入ると `rtmp:// host /code` となり、iOS の URL(string:) が
  //    nil を返して native 側が "invalid url" で落ちる（2026-06-25 実機で発生）。
  //    host/secret/user すべて trim して空白混入を無害化する。
  const host = process.env.STREAM_HOST?.trim();
  const secret = process.env.STREAM_PUBLISH_SECRET?.trim();
  const pubUser = (process.env.STREAM_PUBLISH_USER || "spotch").trim();
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

  // 6. URL 構築。MediaMTX の path = "live/<共有コード>"（2要素）。
  //    ★2要素必須: HaishinKit 2.x の RTMPURL は RTMP URL を /app/streamName の2要素前提でパースし、
  //    先頭2要素を削って streamName を作る（クエリは streamName 側に残す）。1要素 (/<code>) だと
  //    <code> が app として消費され publish 名が "?user=&pass=" だけになり認証が壊れる
  //    （HaishinKit/gortmplib 両ソースで確認 + サーバー上 ffmpeg で2要素なら publish認証→HLS成立を実証）。
  //    固定 app "live" を前置して 2要素にすることで HaishinKit が正しく認証を送る。
  //    視聴 HLS も同じパス（https://host/live/<code>/index.m3u8）。Caddy は全パス転送なので変更不要。
  const streamPath = `live/${broadcast.share_code}`;
  const rtmpUrl = `rtmp://${host}/${streamPath}?user=${encodeURIComponent(pubUser)}&pass=${encodeURIComponent(secret)}`;
  const playbackUrl = `https://${host}/${streamPath}/index.m3u8`;

  // 7. 視聴側が HLS URL を見つけられるよう broadcasts に保存（secret は保存しない）。
  //    自前RTMP経路は端末の焼き込み(プレーンテキスト)をやめ、視聴側で CSS の綺麗な
  //    オーバーレイ(ViewerScoreboardOverlay・DBからリアルタイム)を重ねる方式にしたため
  //    scoreboard_burned_in=false（mobile も scoreboardVisible=false で焼き込みOFF）。
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({ stream_playback_url: playbackUrl, scoreboard_burned_in: false })
    .eq("id", broadcast.id);
  if (uErr) {
    // 保存失敗でも配信自体は開始できるよう creds は返す（視聴側の解決のみ遅れる）。
    console.error("[stream/provision] DB update failed:", uErr.message);
  }

  return Response.json({ rtmpUrl, playbackUrl, path: streamPath });
}
