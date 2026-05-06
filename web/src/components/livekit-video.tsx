"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LiveKitRoom,
  VideoTrack,
  RoomAudioRenderer,
  useTracks,
  useConnectionState,
  useParticipants,
} from "@livekit/components-react";
import { Track, ConnectionState, AudioPresets } from "livekit-client";
import { CompositeBroadcasterRenderer } from "@/components/composite-broadcaster-renderer";
import { BroadcastHealthBadges } from "@/components/broadcast-health-badges";
import { useAudioCompressor } from "@/lib/use-audio-compressor";
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

  // 配信者マイクに音割れ防止コンプレッサーをアタッチ（応援の歓声でクリッピングする問題対策）
  // 5/04 BAND 化により無効化:
  // - リミッターのアタックが速すぎて短いアーティファクト（5 秒に 1 回の「びっ」「ぎゅっ」）
  //   が発生していたため
  // - audioCaptureDefaults 側で autoGainControl: true に変更したことで、
  //   OS / WebRTC 標準の AGC が音割れを抑制してくれる（BAND と同じ仕組み）
  // useAudioCompressor();

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

  // 画面スリープ防止 + 電池警告は BroadcastHealthBadges 内で取得・保持する。

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
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[2] flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-[10px] text-gray-300 font-medium tabular-nums">{viewerCount}</span>
        </div>
      )}

      {/* 配信ヘルスバッジ（Wake Lock 失敗・電池残少の警告。接続中のみ表示） */}
      {connectionState === ConnectionState.Connected && <BroadcastHealthBadges />}
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

  // 「Connected だが cameraTrack が無い」状態の経過秒数。
  // 配信者の再接続中・トラック publish 待ちのまま固まる症状（5/04 オーナー指摘）
  // を救済するため、一定時間経過したらリロードボタンを目立つ位置に表示する。
  const [waitingForTrackSeconds, setWaitingForTrackSeconds] = useState(0);
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || cameraTrack) {
      setWaitingForTrackSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setWaitingForTrackSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [connectionState, cameraTrack]);

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
            {reconnectSeconds >= 10 && reconnectSeconds < 30 && (
              <p className="text-[11px] text-yellow-300 leading-relaxed">
                配信者の電波状況が悪い可能性があります
              </p>
            )}
            {/* 30 秒以上再接続できない = LiveKit クライアント側の自動回復が
                効いていない可能性大。視聴者がリロードで新しい接続を張り直せる
                ボタンを目立つ場所に提示。 */}
            {reconnectSeconds >= 30 && (
              <>
                <p className="text-[11px] text-yellow-300 leading-relaxed">
                  自動再接続が効いていないようです。<br />
                  リロードで新しい接続を試してください。
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#e63946] hover:bg-[#d62836] active:bg-[#c41f2e] text-white text-xs font-semibold transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M5 9a8 8 0 0114-3m1 9a8 8 0 01-14 3" />
                  </svg>
                  リロードして再接続
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* 切断時のオーバーレイ。
          以前は prevState===Connected の前提で出していたため、状態遷移の取りこぼしや
          初回接続失敗時にオーバーレイが表示されず「終了画面で固まってホームに戻れない」
          クレームの原因になっていた（2026-04-26）。Disconnected なら常に表示する。 */}
      {connectionState === ConnectionState.Disconnected && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-2 px-6 py-5 bg-[#111] border border-white/10 rounded-xl max-w-xs text-center" role="status">
            <p className="text-sm font-semibold text-gray-200">配信が終了しました</p>
            <p className="text-[11px] text-gray-400">
              配信者がストリームを停止したか、回線が切断されました
            </p>
            <Link
              href="/"
              className="mt-2 inline-block px-4 py-2 rounded-md bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold"
            >
              ホームへ戻る
            </Link>
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
          <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-gray-500">
            配信者の接続を待っています...
            {waitingForTrackSeconds > 0 && ` (${waitingForTrackSeconds}秒)`}
          </p>
          {/* 30 秒以上 cameraTrack が来ない = 配信者側の publish が
              再接続後にうまく届いていない可能性。視聴者がリロードで
              新しい subscribe を張り直せるボタンを提示。 */}
          {waitingForTrackSeconds >= 30 && (
            <>
              <p className="text-[11px] text-yellow-300 text-center leading-relaxed max-w-xs">
                映像が届かない状態が続いています。<br />
                リロードで新しい接続を試してください。
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#e63946] hover:bg-[#d62836] active:bg-[#c41f2e] text-white text-xs font-semibold transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M5 9a8 8 0 0114-3m1 9a8 8 0 01-14 3" />
                </svg>
                リロードして再接続
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* 視聴者数 */}
      {connectionState === ConnectionState.Connected && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[2] flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
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
  isSharing = false,
  startSharingRef,
  endSharingRef,
}: {
  token: string;
  serverUrl: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  burnScoreboard?: boolean;
  scoreboardState?: ScoreboardState;
  broadcastResolution?: BroadcastResolution;
  // LINE 共有中（Safari バックグラウンド）に視聴者画面のブラックアウトを
  // 防ぐため、canvas を「URL 共有中」オーバーレイに切り替えるフラグ
  isSharing?: boolean;
  // 共有ボタン onClick から canvas を同期描画するための ref。
  // setIsSharing(true) は React 経由の非同期更新で Safari バックグラウンド
  // 遷移までに描画が間に合わないため、ref ベースで直接同期実行する経路を持つ。
  // deadlineMs (epoch ms) を渡すとカウントダウン表示を有効化。
  startSharingRef?: React.MutableRefObject<((deadlineMs?: number) => void) | null>;
  endSharingRef?: React.MutableRefObject<(() => void) | null>;
}) {
  // 焼き込みモード: カメラ + スコアを canvas 合成して video のみ手動 publish。
  // 音声は LiveKit の auto-publish (audio=true) で枯れたコードパスに任せる。
  if (burnScoreboard && scoreboardState && broadcastResolution) {
    return (
      <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <LiveKitRoom
          serverUrl={serverUrl}
          token={token}
          connect={true}
          video={false}
          audio={true}
          onError={onError}
          options={{
            adaptiveStream: true,
            dynacast: true,
            audioCaptureDefaults: {
              // 5/05 RAW 化: AGC が大音量入力（撮影者の声）を検出して全体ゲインを
              // 下げる ducking 効果で、声と同時にコート音が消える事象が発生。
              // 体育館配信ではコート音の連続性が最優先のため、OS 側の音声処理を
              // 全部 OFF にして「マイクが拾ったままの音」を送る方針に変更。
              // - 音割れリスクは「マイク部分を口から離す」運用で対処
              // - 残響を「エコー」と誤判定するリスク回避のため EC も OFF
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              // ステレオマイク対応端末（iPhone XS+, Pixel/Galaxy 上位機種等）で
              // 観客席の左右の声援・ボール音の方向感を伝送可能にする
              channelCount: 2,
            },
            publishDefaults: {
              // 128kbps Opus stereo（musicHighQualityStereo）で歓声・ホイッスル・
              // スパイク音等を立体的に伝送。映像 720p+2.5Mbps と組み合わせて発熱
              // 影響微小（音声 +32kbps ≒ +1% 帯域）。
              audioPreset: AudioPresets.musicHighQualityStereo,
              // RED (Redundant Encoding) でパケットロス時の音切れ防止
              red: true,
            },
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
            isSharing={isSharing}
            startSharingRef={startSharingRef}
            endSharingRef={endSharingRef}
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
            resolution: { width: 1280, height: 720, frameRate: 30 },
          },
          audioCaptureDefaults: {
            // 5/05 RAW 化: 上の焼き込みパスと同じ理由で OS 側音声処理を全 OFF
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            // ステレオマイク対応端末で観客席の左右の声援・ボール音の方向感を伝送
            channelCount: 2,
          },
          publishDefaults: {
            simulcast: true,
            videoCodec: "h264",
            videoEncoding: {
              maxBitrate: 2_500_000,
              maxFramerate: 30,
            },
            // 128kbps Opus stereo で歓声・ホイッスル・スパイク音を立体的に伝送
            audioPreset: AudioPresets.musicHighQualityStereo,
            red: true,
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
