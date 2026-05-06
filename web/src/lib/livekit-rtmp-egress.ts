import {
  StreamOutput,
  StreamProtocol,
  EncodingOptions,
  AudioCodec,
  VideoCodec,
  TrackType,
} from "livekit-server-sdk";
import { getEgressClient, getRoomServiceClient } from "./livekit-egress";

/**
 * RTMP push 用の EncodingOptions（YouTube Live 受信品質を最大化）。
 *
 * 5/06 改修:
 * - 配信側 1080p → 720p 引き下げ（user-agent.ts pickBroadcastResolution）に
 *   合わせて Egress も 720p に統一。元素材より高い解像度を Egress 側で
 *   宣言してもアップスケール限界で品質改善せず、bitrate を無駄に消費するため。
 * - videoBitrate: 8 Mbps → 4 Mbps（YouTube 推奨 720p30 bitrate 1.5-4 Mbps の上限）
 * - videoCodec: H264_MAIN → **H264_HIGH**（同 bitrate で 10-15% 圧縮効率 UP、
 *   互換性は iOS/Android/PC ブラウザほぼ全部 OK）
 * - keyFrameInterval: 2 → **1 秒**（動きの多いシーンチェンジ・カメラパンで
 *   品質安定。データ量 +5-10% 程度）
 *
 * 不変:
 * - audioCodec: AAC（YouTube Live ingest が必須要件）
 * - audioBitrate: 128 kbps（音声品質維持）
 *
 * 配信者スマホへの負荷ゼロ（LiveKit Cloud 側の処理）。
 * transcode minutes は時間ベースのため bitrate 変更で消費量変化なし。
 */
const RTMP_HIGH_QUALITY_ENCODING = new EncodingOptions({
  width: 1280,
  height: 720,
  framerate: 30,
  videoCodec: VideoCodec.H264_HIGH,
  videoBitrate: 4_000,
  keyFrameInterval: 1,
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
 * 配信者の publish track ID を取得する。
 *
 * LiveKit に publish 済みの participant 一覧から、broadcasterIdentity と
 * 一致する participant を探し、その audio/video track の sid (track ID) を返す。
 *
 * 配信開始直後はまだ publish 完了していない可能性があるため、最大 5 回
 * 1 秒間隔でリトライする。それでも見つからなければ null を返す
 * （呼び出し元で RoomCompositeEgress フォールバック）。
 */
async function waitForBroadcasterTracks(
  roomName: string,
  broadcasterIdentity: string,
  maxAttempts = 5,
): Promise<{ audioTrackId: string; videoTrackId: string } | null> {
  const roomService = getRoomServiceClient();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const participants = await roomService.listParticipants(roomName);
      const broadcaster = participants.find(
        (p) => p.identity === broadcasterIdentity,
      );
      if (broadcaster) {
        const audioTrack = broadcaster.tracks.find(
          (t) => t.type === TrackType.AUDIO,
        );
        const videoTrack = broadcaster.tracks.find(
          (t) => t.type === TrackType.VIDEO,
        );
        if (audioTrack && videoTrack) {
          return { audioTrackId: audioTrack.sid, videoTrackId: videoTrack.sid };
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown";
      console.warn(
        `[rtmp-egress] listParticipants attempt ${attempt + 1} failed: ${message}`,
      );
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

/**
 * RTMP push を開始する。
 *
 * YouTube Live の場合、url は `rtmp://a.rtmp.youtube.com/live2`、key は
 * `xxxx-xxxx-xxxx-xxxx-xxxx` のような文字列。LiveKit に渡すときは
 * `${url}/${key}` の形式に組み立てる。
 *
 * **Egress 種別の選択（5/04 改修）**:
 *   優先: TrackCompositeEgress（配信者の publish track を直接 RTMP push）
 *   fallback: RoomCompositeEgress（仮想 Chrome で room 全体を再合成して push）
 *
 *   TrackComposite は仮想 Chrome 合成を経由しないため再エンコードが 1 段
 *   減り、YouTube 受信品質が大幅に改善する（配信者は既に Canvas で
 *   スコアボード焼き込み済みのため再合成は不要）。
 *
 *   broadcaster の track が listParticipants で見つからない場合
 *  （publish 直後のタイミング等）に備えて RoomComposite に自動フォールバック。
 *
 * encodingOptions は preset ではなく明示指定（RTMP_HIGH_QUALITY_ENCODING）。
 * 配信者は 1080p / 5 Mbps を publish しており、Egress 側 8 Mbps で
 * 受け取るため YouTube 受信時の追加圧縮アーチファクトを最小化する設計。
 *
 * @param roomName LiveKit ルーム名（broadcasts.share_code と同じ）
 * @param broadcasterIdentity 配信者の identity（= Supabase user.id）。
 *   TrackCompositeEgress で track ID を引くために必須。
 * @param rtmpIngestUrl YouTube Live API が createLiveStream で返す ingestionAddress
 * @param streamKey 同 createLiveStream の streamName。漏洩厳禁（DB に保存しない）
 * @returns LiveKit Egress ID。停止 API 呼出と webhook 突合に使う。
 */
export async function startRtmpEgress(
  roomName: string,
  broadcasterIdentity: string,
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

  // 案 B: TrackCompositeEgress を優先試行（仮想 Chrome 合成を経由しないため
  // 抜本的に画質が改善する）
  const trackIds = await waitForBroadcasterTracks(roomName, broadcasterIdentity);
  if (trackIds) {
    try {
      const info = await getEgressClient().startTrackCompositeEgress(
        roomName,
        streamOutput,
        {
          audioTrackId: trackIds.audioTrackId,
          videoTrackId: trackIds.videoTrackId,
          encodingOptions: RTMP_HIGH_QUALITY_ENCODING,
        },
      );
      console.log(
        `[rtmp-egress] TrackCompositeEgress 開始 (egressId=${info.egressId}, ` +
          `audio=${trackIds.audioTrackId}, video=${trackIds.videoTrackId})`,
      );
      return info.egressId;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown";
      console.warn(
        `[rtmp-egress] TrackCompositeEgress 失敗 → RoomCompositeEgress フォールバック: ${message}`,
      );
    }
  } else {
    console.warn(
      `[rtmp-egress] broadcaster track が listParticipants で見つからず → ` +
        "RoomCompositeEgress フォールバック",
    );
  }

  // フォールバック: 旧 RoomCompositeEgress（仮想 Chrome で再合成して push）
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
  console.log(
    `[rtmp-egress] RoomCompositeEgress (fallback) 開始 (egressId=${info.egressId})`,
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
