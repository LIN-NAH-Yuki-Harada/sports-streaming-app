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
import { useAudioCompressor } from "@/lib/use-audio-compressor";
import { BroadcastHealthBadges } from "@/components/broadcast-health-badges";
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
  const { canvasRef, videoRef, videoTrack, status, error } = composite;

  // 配信者マイクに音割れ防止コンプレッサーをアタッチ（応援の歓声でクリッピングする問題対策）
  useAudioCompressor();

  // 音声は LiveKitRoom の audio={true} 経由で auto-publish される（livekit-video.tsx 側で設定済み）。
  // ここで手動 publish するのは Canvas 合成 video のみ。
  const publishedVideoRef = useRef<LocalTrackPublication | null>(null);

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

  // 画面スリープ防止 + 電池警告は BroadcastHealthBadges 内で取得・保持する。

  // Connected + 合成 video トラック準備完了で publish（音声は LiveKit が自動 publish）
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) return;
    if (!localParticipant) return;
    if (!videoTrack) return;
    if (publishedVideoRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const videoPub = await localParticipant.publishTrack(videoTrack, {
          source: Track.Source.Camera,
          simulcast: true,
          videoCodec: "h264",
          videoEncoding: {
            // 5/03: 配信チェーン全体を 1080p に引き上げに伴い、
            // bitrate も 2.5Mbps → 5Mbps に倍化。
            // YouTube 推奨 1080p30 bitrate (4.5-9 Mbps) の中央値。
            // 発熱リスクは室内競技なら問題ないが、夏屋外で症状が出たら下げる。
            maxBitrate: 5_000_000,
            maxFramerate: 30,
          },
        });
        if (cancelled) {
          await localParticipant.unpublishTrack(videoTrack, true);
          return;
        }
        publishedVideoRef.current = videoPub;
      } catch (e) {
        console.error("[composite] publishTrack エラー:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionState, localParticipant, videoTrack]);

  // アンマウント時に unpublish
  useEffect(() => {
    return () => {
      const lp = localParticipant;
      const video = publishedVideoRef.current;
      if (!lp) return;
      if (video?.track) {
        lp.unpublishTrack(video.track, true).catch(() => {});
      }
      publishedVideoRef.current = null;
    };
    // localParticipant が落ちたタイミングでも cleanup させたいので依存にしない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/*
        隠し video (camera source) — display:none ではなく 1px 透明配置。
        iOS Safari は display:none の <video> を「再生中」と認識せず、
        Wake Lock とは別系統で画面ロックを発動させるため、視覚的には不可視のまま
        レンダリングは維持する（NoSleep.js 系の手法）。
      */}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "1px",
          height: "1px",
          opacity: 0,
          pointerEvents: "none",
          zIndex: -1,
        }}
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

      {/* 配信ヘルスバッジ（Wake Lock 失敗・電池残少の警告。接続中のみ表示） */}
      {connectionState === ConnectionState.Connected && <BroadcastHealthBadges />}
    </>
  );
}
