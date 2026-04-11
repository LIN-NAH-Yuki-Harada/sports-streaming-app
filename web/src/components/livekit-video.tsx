"use client";

import { useEffect, useRef } from "react";
import {
  LiveKitRoom,
  VideoTrack,
  RoomAudioRenderer,
  useTracks,
  useConnectionState,
  useParticipants,
} from "@livekit/components-react";
import { Track, ConnectionState } from "livekit-client";

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

  // 画面スリープ防止
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    if ("wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then((wl) => {
        wakeLock = wl;
      }).catch(() => {});
    }
    return () => {
      wakeLock?.release();
    };
  }, []);

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
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black/50">
          <p className="text-xs text-yellow-400">再接続中...</p>
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
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black/50">
          <p className="text-xs text-yellow-400">再接続中...</p>
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
}: {
  token: string;
  serverUrl: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}) {
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
          videoCaptureDefaults: {
            facingMode: "environment",
            resolution: { width: 1280, height: 720, frameRate: 30 },
          },
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
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
