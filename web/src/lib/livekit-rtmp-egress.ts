import {
  StreamOutput,
  StreamProtocol,
  EncodingOptions,
  AudioCodec,
  VideoCodec,
} from "livekit-server-sdk";
import { getEgressClient } from "./livekit-egress";

/**
 * RTMP push 用の EncodingOptions（YouTube Live 受信品質を最大化）。
 *
 * - videoBitrate: 8 Mbps（preset デフォルト 4.5 Mbps の約 1.8 倍）
 *   YouTube 推奨 1080p30 bitrate (4.5-9 Mbps) の上限近く。
 *   YouTube 受信時の圧縮アーチファクト軽減効果あり。
 *   → LiveKit Cloud 側の処理なので配信者スマホへの負荷ゼロ。
 *   → transcode minutes は時間ベースのため bitrate 上げても消費量変化なし。
 * - keyFrameInterval: 2 秒（YouTube 推奨）。
 *   preset デフォルト 4 秒だと CDN 側のシークやサムネ生成精度が落ちる。
 * - audioCodec: AAC（YouTube Live ingest が必須要件）。
 * - videoCodec: H264_MAIN（preset と同等・互換性最大）。
 */
const RTMP_HIGH_QUALITY_ENCODING = new EncodingOptions({
  width: 1920,
  height: 1080,
  framerate: 30,
  videoCodec: VideoCodec.H264_MAIN,
  videoBitrate: 8_000,
  keyFrameInterval: 2,
  audioCodec: AudioCodec.AAC,
  audioBitrate: 128,
  audioFrequency: 44_100,
});

/**
 * LiveKit Egress を **RTMP push** 出力で起動する（Live 中継移行 PR-3）。
 *
 * 既存の livekit-egress.ts は S3 出力（録画→アップロード）専用。本ファイルは
 * 同じ EgressClient を使いつつ、Output だけ StreamOutput に切り替える。
 *
 * 仕組み:
 *   LiveKit Cloud のサーバー側で配信ルームを composite して、得られた映像/音声を
 *   指定された RTMP URL に push する。本サービスでは YouTube Live ingest を
 *   destination とする想定。
 *
 * フラグ NEXT_PUBLIC_LIVE_ARCHIVE が false の間はどこからも呼ばれない。
 * PR-3 単体マージ時は本番動作に影響なし。
 *
 * 呼び出し元: web/src/app/api/livekit/live/start/route.ts (PR-3 で実装)
 */

/**
 * RTMP push を開始する。
 *
 * YouTube Live の場合、url は `rtmp://a.rtmp.youtube.com/live2`、key は
 * `xxxx-xxxx-xxxx-xxxx-xxxx` のような文字列。LiveKit に渡すときは
 * `${url}/${key}` の形式に組み立てる。
 *
 * encodingOptions は preset ではなく明示指定（RTMP_HIGH_QUALITY_ENCODING）。
 * RTMP の場合 LiveKit Cloud → YouTube Live ingest までは LiveKit が直接配信し、
 * その後 YouTube 側で再エンコードされて視聴者に届く。
 * 配信者は 1080p / 5 Mbps を publish しており、Egress 側 8 Mbps で受け取る
 * ため YouTube 受信時の追加圧縮アーチファクトを最小化する設計。
 *
 * @param roomName LiveKit ルーム名（broadcasts.share_code と同じ）
 * @param rtmpIngestUrl YouTube Live API が createLiveStream で返す ingestionAddress
 * @param streamKey 同 createLiveStream の streamName。漏洩厳禁（DB に保存しない）
 * @returns LiveKit Egress ID。停止 API 呼出と webhook 突合に使う。
 *
 * @throws LiveKit Cloud 側エラー（quota 超過 / network 不調 等）。呼出側で
 *   classifyError 相当の分類を行う。
 */
export async function startRtmpEgress(
  roomName: string,
  rtmpIngestUrl: string,
  streamKey: string,
): Promise<string> {
  // YouTube ingest URL の末尾スラッシュ正規化（API が末尾 / 付き／無しで揺れるため）
  const trimmedUrl = rtmpIngestUrl.replace(/\/+$/, "");
  const fullUrl = `${trimmedUrl}/${streamKey}`;

  const streamOutput = new StreamOutput({
    protocol: StreamProtocol.RTMP,
    urls: [fullUrl],
  });

  const info = await getEgressClient().startRoomCompositeEgress(
    roomName,
    streamOutput,
    {
      layout: "speaker",
      encodingOptions: RTMP_HIGH_QUALITY_ENCODING,
      audioOnly: false,
      videoOnly: false,
    },
  );

  return info.egressId;
}

/**
 * RTMP push 中の Egress を停止する。
 *
 * 既存 livekit-egress.ts の停止処理と同じく EgressClient.stopEgress を呼ぶだけ。
 * RTMP 切断を YouTube 側が検知すると enableAutoStop=true により Live broadcast が
 * 自動で complete に遷移してアーカイブ動画化される。
 *
 * 停止後は egress_ended webhook が飛ぶ → egress-webhook が live_status='ended'
 * を書き込む。
 */
export async function stopRtmpEgress(egressId: string): Promise<void> {
  await getEgressClient().stopEgress(egressId);
}
