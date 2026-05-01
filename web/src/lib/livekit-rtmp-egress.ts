import {
  StreamOutput,
  StreamProtocol,
  EncodingOptionsPreset,
} from "livekit-server-sdk";
import { getEgressClient } from "./livekit-egress";

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
 * encodingOptions は録画 (livekit-egress.ts) と同じく 1080p preset。
 * RTMP の場合 LiveKit Cloud → YouTube Live ingest までは LiveKit が直接配信し、
 * その後 YouTube 側で再エンコードされて視聴者に届く。LiveKit 側のソースが
 * 720p なので preset を上げてもアップスケール限界はあるが、頭打ちまでは効く。
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
      encodingOptions: EncodingOptionsPreset.H264_1080P_30,
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
