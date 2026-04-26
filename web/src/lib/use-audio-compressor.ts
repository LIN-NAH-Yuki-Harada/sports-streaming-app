"use client";

import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  LocalAudioTrack,
  ParticipantEvent,
  Track,
} from "livekit-client";
import { AudioCompressorProcessor } from "@/lib/audio-compressor-processor";

// 配信者のマイクトラックに音割れ防止コンプレッサーをアタッチする。
//
// LiveKitRoom の audio={true} で auto-publish された LocalAudioTrack に対して
// setProcessor() を呼ぶことで、TrackProcessor 経由で WebAudio エフェクトを
// 挟む。手動 publish していないため PR #36 の iOS Safari 音声欠落は再発しない。
//
// マイクトラックは publish 完了が遅延する場合があるので、初回チェックに加えて
// LocalTrackPublished イベントもリッスンして到着次第アタッチする。
export function useAudioCompressor(enabled: boolean = true): void {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!enabled || !localParticipant) return;

    const processor = new AudioCompressorProcessor();
    let attached = false;

    const tryAttach = async () => {
      if (attached) return;
      const audioTrack = localParticipant.getTrackPublication(Track.Source.Microphone)
        ?.audioTrack;
      if (!(audioTrack instanceof LocalAudioTrack)) return;
      // 既に他のプロセッサが attach されていたら干渉しない
      if (audioTrack.getProcessor()) return;
      try {
        await audioTrack.setProcessor(processor);
        attached = true;
      } catch (err) {
        console.error("[audio-compressor] setProcessor failed:", err);
      }
    };

    void tryAttach();
    const onPublished = () => {
      void tryAttach();
    };
    localParticipant.on(ParticipantEvent.LocalTrackPublished, onPublished);

    return () => {
      localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublished);
      if (attached) {
        void processor.destroy();
      }
    };
  }, [enabled, localParticipant]);
}
