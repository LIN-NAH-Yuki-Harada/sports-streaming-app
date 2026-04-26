import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";

// 配信者の近くで応援する保護者の声でマイク入力がピークを超え、視聴者側で
// 音割れ（クリッピング）するクレーム対策（2026-04-26）。
//
// スマホの単一マイクでは距離による音源分離ができないため「近くだけ消す」
// アプローチは原理的に不可能。代わりに DynamicsCompressorNode で大音量入力を
// 圧縮し、波形がクリッピングしないようにする。コートの音は引き続き伝送される。
//
// 設定値は「歓声で割れない」「小さい音は潰さない」を狙ったやや強めのデフォルト。
//   threshold -18dB / ratio 12:1 / knee 6dB / attack 3ms / release 100ms
// 値を緩めたい場合はここを調整する。
export class AudioCompressorProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "anti-clipping-compressor";
  processedTrack?: MediaStreamTrack;

  private sourceNode?: MediaStreamAudioSourceNode;
  private compressorNode?: DynamicsCompressorNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const ctx = opts.audioContext;
    this.sourceNode = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.compressorNode = ctx.createDynamicsCompressor();
    this.compressorNode.threshold.setValueAtTime(-18, ctx.currentTime);
    this.compressorNode.knee.setValueAtTime(6, ctx.currentTime);
    this.compressorNode.ratio.setValueAtTime(12, ctx.currentTime);
    this.compressorNode.attack.setValueAtTime(0.003, ctx.currentTime);
    this.compressorNode.release.setValueAtTime(0.1, ctx.currentTime);
    this.destinationNode = ctx.createMediaStreamDestination();
    this.sourceNode.connect(this.compressorNode).connect(this.destinationNode);
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    try {
      this.sourceNode?.disconnect();
      this.compressorNode?.disconnect();
      this.destinationNode?.disconnect();
    } catch {
      // 既に切断済みでも問題ないため無視
    }
    this.processedTrack?.stop();
    this.sourceNode = undefined;
    this.compressorNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
  }
}
