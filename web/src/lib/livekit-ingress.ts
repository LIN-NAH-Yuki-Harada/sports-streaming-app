import { IngressClient, IngressInput, type IngressInfo } from "livekit-server-sdk";
import { buildLiveKitHttpUrl } from "./livekit-egress";

/**
 * LiveKit Ingress クライアントの構築と RTMP 取り込み口の生成ヘルパ。
 *
 * Ingress = LiveKit Cloud のサーバー側で、外部から RTMP（または WHIP）で
 * push された映像を「部屋の参加者」として取り込む機能。
 *
 * 【なぜ Ingress か】
 * 現行のネイティブ/Web 配信は WebRTC publish（リアルタイム・送信バッファ無し）。
 * 4G の上り回線が一瞬詰まるとフレームを捨てるため映像が「荒く」なる。
 * RTMP は TCP ＝バッファして再送するため、~数秒の遅延と引き換えに、同じ 4G でも
 * 安定して高ビットレートを通せる（4G 上りの画質天井を突破する本命の手段）。
 *
 * 経路: スマホ(ネイティブ) → RTMP → この Ingress → 既存の配信ルーム
 *        → 自社プレイヤー(WebRTC subscribe) ＋ Egress→YouTube（いずれも無改修）。
 *
 * Ingress 参加者は通常の参加者として部屋に入るため、視聴側・Egress 側は
 * RoomComposite / 任意 Camera トラック購読でそのまま動作する。
 *
 * SRT は LiveKit Ingress 未対応、WHIP は WebRTC（＝バッファ無しで本末転倒）の
 * ため、バッファ型 TCP の RTMP を採用する。
 */

let cachedClient: IngressClient | null = null;

/**
 * IngressClient のシングルトン取得。
 */
export function getIngressClient(): IngressClient {
  if (cachedClient) return cachedClient;
  const { httpUrl, apiKey, apiSecret } = buildLiveKitHttpUrl();
  cachedClient = new IngressClient(httpUrl, apiKey, apiSecret);
  return cachedClient;
}

export type BroadcastIngress = {
  /** 破棄（deleteBroadcastIngress）に使う Ingress ID。broadcasts.live_ingress_id に保存する。 */
  ingressId: string;
  /** スマホアプリが push する RTMP URL（例: rtmp://...）。 */
  rtmpUrl: string;
  /** RTMP ストリームキー。DB には保存せずアプリへ都度返す（YouTube key と同じ扱い）。 */
  streamKey: string;
};

/**
 * 配信ルーム（roomName = share_code）向けの RTMP Ingress を作成する。
 *
 * - enableTranscoding: true（RTMP は transcoding 必須。サーバー側再エンコードなので
 *   配信者端末の負荷ゼロ・4G 帯域とも無関係）。
 * - video / audio の encoding 指定は省略し LiveKit の既定に委ねる（Phase 1）。
 *   将来 720p→1080p などの調整が必要なら IngressVideoOptions の preset/options で固定する。
 */
export async function createBroadcastIngress(
  roomName: string,
  participantIdentity: string,
  participantName = "配信者(アプリ)",
): Promise<BroadcastIngress> {
  const info: IngressInfo = await getIngressClient().createIngress(
    IngressInput.RTMP_INPUT,
    {
      name: `broadcast-${roomName}`,
      roomName,
      participantIdentity,
      participantName,
      // RTMP は forward 不可（WHIP のみ）。サーバー transcoding を有効化する。
      enableTranscoding: true,
    },
  );

  if (!info.url || !info.streamKey || !info.ingressId) {
    throw new Error("Ingress creation returned incomplete info (url/streamKey/ingressId)");
  }

  return {
    ingressId: info.ingressId,
    rtmpUrl: info.url,
    streamKey: info.streamKey,
  };
}

/**
 * Ingress を破棄する（配信終了時 / 再作成前のクリーンアップ）。
 * 既に存在しない場合のエラーは呼出側でベストエフォート処理する。
 */
export async function deleteBroadcastIngress(ingressId: string): Promise<void> {
  await getIngressClient().deleteIngress(ingressId);
}
