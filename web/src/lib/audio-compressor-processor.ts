import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";

// 配信者の近くで応援する保護者の声でマイク入力がピークを超え、視聴者側で
// 音割れ（クリッピング）するクレーム対策（2026-04-26）。
//
// スマホの単一マイクでは距離による音源分離ができないため「近くだけ消す」
// アプローチは原理的に不可能。代わりに 3 段の処理で
//   1) 中音量〜大音量を緩やかに圧縮（DynamicsCompressor）
//   2) -3dB の天井を物理的に超えない（ハードリミッター）
//   3) 仕上げに全体ゲイン -2dB（視聴者が再生した瞬間の音量驚きを抑える）
// を行う。撮影者の声・歓声は天井で抑え込まれ、コートの小さい音は通過するため
// 相対的に「コートを聞き取りやすい」音像になる。
//
// パラメータ調整時は init() 内のセッターを直接書き換える。
export class AudioCompressorProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "anti-clipping-compressor";
  processedTrack?: MediaStreamTrack;

  private sourceNode?: MediaStreamAudioSourceNode;
  private compressorNode?: DynamicsCompressorNode;
  private limiterNode?: DynamicsCompressorNode;
  private makeupGainNode?: GainNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const ctx = opts.audioContext;
    this.sourceNode = ctx.createMediaStreamSource(new MediaStream([opts.track]));

    // 1段目: 緩やかなコンプレッサー（中音量〜大音量を均す）
    this.compressorNode = ctx.createDynamicsCompressor();
    this.compressorNode.threshold.setValueAtTime(-18, ctx.currentTime);
    this.compressorNode.knee.setValueAtTime(6, ctx.currentTime);
    this.compressorNode.ratio.setValueAtTime(12, ctx.currentTime);
    this.compressorNode.attack.setValueAtTime(0.003, ctx.currentTime);
    this.compressorNode.release.setValueAtTime(0.1, ctx.currentTime);

    // 2段目: ハードリミッター（-3dB を絶対に超えない天井）
    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.threshold.setValueAtTime(-3, ctx.currentTime);
    this.limiterNode.knee.setValueAtTime(0, ctx.currentTime);
    this.limiterNode.ratio.setValueAtTime(20, ctx.currentTime);
    this.limiterNode.attack.setValueAtTime(0.0005, ctx.currentTime);
    this.limiterNode.release.setValueAtTime(0.05, ctx.currentTime);

    // 3段目: メイクアップ/トリムゲイン -2dB（≒0.8x）
    this.makeupGainNode = ctx.createGain();
    this.makeupGainNode.gain.setValueAtTime(0.8, ctx.currentTime);

    this.destinationNode = ctx.createMediaStreamDestination();
    this.sourceNode
      .connect(this.compressorNode)
      .connect(this.limiterNode)
      .connect(this.makeupGainNode)
      .connect(this.destinationNode);
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
      this.limiterNode?.disconnect();
      this.makeupGainNode?.disconnect();
      this.destinationNode?.disconnect();
    } catch {
      // 既に切断済みでも問題ないため無視
    }
    this.processedTrack?.stop();
    this.sourceNode = undefined;
    this.compressorNode = undefined;
    this.limiterNode = undefined;
    this.makeupGainNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
  }
}
