"use client";

import { useEffect, useRef } from "react";
import {
  useConnectionState,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react";
import { ConnectionState, Track, type LocalTrackPublication } from "livekit-client";
import { useReconnectDuration } from "@/components/livekit-video";
import { useCompositeBroadcastTrack } from "@/lib/use-composite-broadcast-track";
import { useWakeLock } from "@/lib/use-wake-lock";
import type { ScoreboardState } from "@/lib/scoreboard-canvas";
import type { BroadcastResolution } from "@/lib/user-agent";

type Props = {
  state: ScoreboardState;
  targetResolution: BroadcastResolution;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

export function CompositeBroadcasterRenderer({
  state,
  targetResolution,
  onConnected,
  onDisconnected,
}: Props) {
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const viewerCount = Math.max(0, participants.length - 1);
  const prevConn = useRef(connectionState);
  const reconnectSeconds = useReconnectDuration(connectionState);

  const composite = useCompositeBroadcastTrack({
    state,
    targetResolution,
    enabled: true,
  });
  const { canvasRef, videoRef, videoTrack, audioTrack, status, error } = composite;

  const publishedRef = useRef<{
    video: LocalTrackPublication | null;
    audio: LocalTrackPublication | null;
  }>({ video: null, audio: null });

  // 接続状態の変化を通知
  useEffect(() => {
    if (
      prevConn.current !== ConnectionState.Connected &&
      connectionState === ConnectionState.Connected
    ) {
      onConnected?.();
    }
    if (
      prevConn.current === ConnectionState.Connected &&
      connectionState === ConnectionState.Disconnected
    ) {
      onDisconnected?.();
    }
    prevConn.current = connectionState;
  }, [connectionState, onConnected, onDisconnected]);

  // 画面スリープ防止（visibilitychange で自動再取得）
  useWakeLock(true);

  // Connected + 合成トラック準備完了で publish
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) return;
    if (!localParticipant) return;
    if (!videoTrack || !audioTrack) return;
    if (publishedRef.current.video || publishedRef.current.audio) return;

    let cancelled = false;
    (async () => {
      try {
        const videoPub = await localParticipant.publishTrack(videoTrack, {
          source: Track.Source.Camera,
          simulcast: true,
          videoCodec: "h264",
          videoEncoding: {
            maxBitrate: 4_000_000,
            maxFramerate: 30,
          },
        });
        if (cancelled) {
          await localParticipant.unpublishTrack(videoTrack, true);
          return;
        }
        publishedRef.current.video = videoPub;

        const audioPub = await localParticipant.publishTrack(audioTrack, {
          source: Track.Source.Microphone,
        });
        if (cancelled) {
          await localParticipant.unpublishTrack(audioTrack, true);
          return;
        }
        publishedRef.current.audio = audioPub;
      } catch (e) {
        console.error("[composite] publishTrack エラー:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionState, localParticipant, videoTrack, audioTrack]);

  // アンマウント時に unpublish
  useEffect(() => {
    return () => {
      const lp = localParticipant;
      const { video, audio } = publishedRef.current;
      if (!lp) return;
      if (video?.track) {
        lp.unpublishTrack(video.track, true).catch(() => {});
      }
      if (audio?.track) {
        lp.unpublishTrack(audio.track, true).catch(() => {});
      }
      publishedRef.current = { video: null, audio: null };
    };
    // localParticipant が落ちたタイミングでも cleanup させたいので依存にしない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* 隠し video (camera source) */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ display: "none" }}
      />

      {/* 可視 canvas (焼き込み済みプレビュー) */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#000",
        }}
      />

      {/* 接続状態表示 */}
      {(status === "acquiring" ||
        (status === "ready" && connectionState === ConnectionState.Connecting)) && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-gray-300">
              {status === "acquiring" ? "カメラに接続中..." : "配信サーバーに接続中..."}
            </p>
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-2 px-6 py-5 bg-[#111] border border-white/10 rounded-xl max-w-xs text-center">
            <p className="text-sm font-semibold text-[#e63946]">
              カメラの取得に失敗しました
            </p>
            <p className="text-[11px] text-gray-400">
              {error?.message ?? "もう一度配信を開始してください"}
            </p>
          </div>
        </div>
      )}
      {connectionState === ConnectionState.Reconnecting && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="flex flex-col items-center gap-3 px-6 py-5 bg-[#1a0808] border border-[#e63946]/50 rounded-xl max-w-xs text-center shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold text-[#e63946]">再接続中…</span>
            </div>
            <p className="text-xs text-gray-300">
              ネットワークが不安定です ({reconnectSeconds}秒)
            </p>
            {reconnectSeconds >= 30 && (
              <p className="text-[11px] text-yellow-400 leading-relaxed">
                📍 電波の良い場所への移動をおすすめします
              </p>
            )}
          </div>
        </div>
      )}
      {connectionState === ConnectionState.Disconnected &&
        prevConn.current === ConnectionState.Connected && (
          <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/80">
            <div
              className="flex flex-col items-center gap-2 px-6 py-5 bg-[#111] border border-white/10 rounded-xl max-w-xs text-center"
              role="status"
            >
              <p className="text-sm font-semibold text-gray-200">
                配信が切断されました
              </p>
              <p className="text-[11px] text-gray-400">
                ネットワークに接続してから、画面を閉じて再度配信を開始してください
              </p>
            </div>
          </div>
        )}

      {/* 視聴者数 */}
      {connectionState === ConnectionState.Connected && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[2] flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
          <svg
            className="w-3 h-3 text-gray-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <span className="text-[10px] text-gray-300 font-medium tabular-nums">
            {viewerCount}
          </span>
        </div>
      )}
    </>
  );
}
