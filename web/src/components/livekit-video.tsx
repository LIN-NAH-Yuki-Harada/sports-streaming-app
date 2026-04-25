"use client";

import { useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoTrack,
  RoomAudioRenderer,
  useTracks,
  useConnectionState,
  useParticipants,
} from "@livekit/components-react";
import { Track, ConnectionState } from "livekit-client";
import { CompositeBroadcasterRenderer } from "@/components/composite-broadcaster-renderer";
import { useWakeLock } from "@/lib/use-wake-lock";
import type { ScoreboardState } from "@/lib/scoreboard-canvas";
import type { BroadcastResolution } from "@/lib/user-agent";

// Reconnecting 状態の経過秒数を計測するフック
export function useReconnectDuration(connectionState: ConnectionState): number {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (connectionState === ConnectionState.Reconnecting) {
      if (startRef.current === null) startRef.current = Date.now();
      const interval = window.setInterval(() => {
        if (startRef.current !== null) {
          setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 1000);
      return () => window.clearInterval(interval);
    }
    startRef.current = null;
    setSeconds(0);
  }, [connectionState]);

  return seconds;
}

// ============================
// 配信者用: カメラ映像を表示
// ============================
function BroadcasterRenderer({
  onConnected,
  onDisconnected,
}: {
  onConnected?: () => void;
  onDisconnected?: () => void;
}) {
  const connectionState = useConnectionState();
  const tracks = useTracks([Track.Source.Camera]);
  const participants = useParticipants();
  const viewerCount = Math.max(0, participants.length - 1); // 自分を除く
  const prevState = useRef(connectionState);
  const reconnectSeconds = useReconnectDuration(connectionState);

  useEffect(() => {
    if (
      prevState.current !== ConnectionState.Connected &&
      connectionState === ConnectionState.Connected
    ) {
      onConnected?.();
    }
    if (
      prevState.current === ConnectionState.Connected &&
      connectionState === ConnectionState.Disconnected
    ) {
      onDisconnected?.();
    }
    prevState.current = connectionState;
  }, [connectionState, onConnected, onDisconnected]);

  // 画面スリープ防止（visibilitychange で自動再取得）
  useWakeLock(true);

  const cameraTrack = tracks.find(
    (t) => t.source === Track.Source.Camera && t.publication?.track
  );

  return (
    <>
      {/* 接続状態表示 */}
      {connectionState === ConnectionState.Connecting && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-gray-300">カメラに接続中...</p>
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
              <div className="w-4 h-4 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
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
      {connectionState === ConnectionState.Disconnected && prevState.current === ConnectionState.Connected && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-2 px-6 py-5 bg-[#111] border border-white/10 rounded-xl max-w-xs text-center" role="status">
            <p className="text-sm font-semibold text-gray-200">配信が切断されました</p>
            <p className="text-[11px] text-gray-400">
              ネットワークに接続してから、画面を閉じて再度配信を開始してください
            </p>
          </div>
        </div>
      )}

      {/* カメラ映像 */}
      {cameraTrack?.publication?.track && (
        <VideoTrack
          trackRef={cameraTrack}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {/* 視聴者数 */}
      {connectionState === ConnectionState.Connected && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[2] flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-[10px] text-gray-300 font-medium tabular-nums">{viewerCount}</span>
        </div>
      )}
    </>
  );
}

// ============================
// 視聴者用: 配信者の映像を表示
// ============================
function ViewerRenderer() {
  const connectionState = useConnectionState();
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone]);
  const participants = useParticipants();
  const reconnectSeconds = useReconnectDuration(connectionState);
  const prevState = useRef(connectionState);

  useEffect(() => {
    prevState.current = connectionState;
  }, [connectionState]);

  const cameraTrack = tracks.find(
    (t) => t.source === Track.Source.Camera && t.publication?.track
  );

  return (
    <>
      <RoomAudioRenderer />

      {/* 接続状態表示 */}
      {connectionState === ConnectionState.Connecting && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-gray-300">接続中...</p>
          </div>
        </div>
      )}
      {connectionState === ConnectionState.Reconnecting && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="flex flex-col items-center gap-3 px-6 py-5 bg-[#1a1608] border border-yellow-500/40 rounded-xl max-w-xs text-center shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              <span className="text-sm font-semibold text-yellow-400">配信が途切れています</span>
            </div>
            <p className="text-xs text-gray-300">再接続中… ({reconnectSeconds}秒)</p>
            {reconnectSeconds >= 10 && (
              <p className="text-[11px] text-yellow-300 leading-relaxed">
                配信者の電波状況が悪い可能性があります
              </p>
            )}
          </div>
        </div>
      )}
      {connectionState === ConnectionState.Disconnected && prevState.current === ConnectionState.Connected && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-2 px-6 py-5 bg-[#111] border border-white/10 rounded-xl max-w-xs text-center" role="status">
            <p className="text-sm font-semibold text-gray-200">配信が終了しました</p>
            <p className="text-[11px] text-gray-400">
              配信者がストリームを停止したか、回線が切断されました
            </p>
            <a
              href="/"
              className="mt-2 inline-block px-4 py-2 rounded-md bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold"
            >
              ホームへ戻る
            </a>
          </div>
        </div>
      )}

      {/* 配信者の映像（視聴者側はcontainで全体表示） */}
      {cameraTrack?.publication?.track ? (
        <VideoTrack
          trackRef={cameraTrack}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            backgroundColor: "#000",
          }}
        />
      ) : connectionState === ConnectionState.Connected ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-xs text-gray-500">配信者の接続を待っています...</p>
        </div>
      ) : null}

      {/* 視聴者数 */}
      {connectionState === ConnectionState.Connected && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[2] flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-[10px] text-gray-300 font-medium tabular-nums">{participants.length}</span>
        </div>
      )}
    </>
  );
}

// ============================
// 配信者コンポーネント（外部API）
// ============================
export function LiveKitBroadcaster({
  token,
  serverUrl,
  onConnected,
  onDisconnected,
  onError,
  burnScoreboard = false,
  scoreboardState,
  broadcastResolution,
}: {
  token: string;
  serverUrl: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  burnScoreboard?: boolean;
  scoreboardState?: ScoreboardState;
  broadcastResolution?: BroadcastResolution;
}) {
  // 焼き込みモード: カメラ + スコアを canvas 合成してから publish
  if (burnScoreboard && scoreboardState && broadcastResolution) {
    return (
      <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <LiveKitRoom
          serverUrl={serverUrl}
          token={token}
          connect={true}
          video={false}
          audio={false}
          onError={onError}
          options={{
            adaptiveStream: true,
            dynacast: true,
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        >
          <CompositeBroadcasterRenderer
            state={scoreboardState}
            targetResolution={broadcastResolution}
            onConnected={onConnected}
            onDisconnected={onDisconnected}
          />
        </LiveKitRoom>
      </div>
    );
  }

  // 既存経路: LiveKit 自動 publish + CSS オーバーレイ（視聴者側）
  return (
    <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect={true}
        video={true}
        audio={true}
        onError={onError}
        options={{
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            facingMode: "environment",
            resolution: { width: 1920, height: 1080, frameRate: 30 },
          },
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
          },
          publishDefaults: {
            simulcast: true,
            videoCodec: "h264",
            videoEncoding: {
              maxBitrate: 4_000_000,
              maxFramerate: 30,
            },
          },
        }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <BroadcasterRenderer
          onConnected={onConnected}
          onDisconnected={onDisconnected}
        />
      </LiveKitRoom>
    </div>
  );
}

// ============================
// 視聴者コンポーネント（外部API）
// ============================
export function LiveKitViewer({
  token,
  serverUrl,
}: {
  token: string;
  serverUrl: string;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect={true}
        video={false}
        audio={false}
        options={{
          adaptiveStream: true,
          dynacast: true,
        }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <ViewerRenderer />
      </LiveKitRoom>
    </div>
  );
}
