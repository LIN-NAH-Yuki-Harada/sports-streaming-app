"use client";

import { useCallback, useRef } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";
import { drawSharingOverlay } from "@/lib/use-composite-broadcast-track";

/**
 * 生配信（焼き込みOFF）経路用の「共有キープアライブ」フック（発熱対策 Phase 1-A）。
 *
 * 焼き込みOFF経路はカメラ映像を直接 publish しているため、LINE 共有で配信者が
 * 別アプリに移って Safari がバックグラウンドに入ると、カメラトラックが止まり
 * publish が切れて視聴者が「配信者の接続を待っています」になる不具合があった。
 *
 * 合成（焼き込み）経路は常に canvas.captureStream を publish しており、背景でも
 * 「最後に描いたフレーム」を emit し続けるため切れない。本フックはその効果を生配信
 * 経路にも持ち込む:
 *   - 共有開始時: 「📱URL共有中」を描いた canvas の captureStream トラックに
 *     `replaceTrack` で一時差し替える（背景でも最後のフレームが流れ続ける）。
 *   - 共有解除時（visibility 復帰 / タイムアウト）: 元のカメラトラックに戻す。
 *     背景中にカメラトラックが終了していた場合は getUserMedia で取り直す。
 *
 * ベストエフォート: replaceTrack は非同期のため、共有シート（前景オーバーレイ）が
 * 開いている数百ms〜数秒の間に差し替えが完了することを前提とする。差し替え前に
 * ユーザーが即座に別アプリへ移った場合は保護が間に合わないことがある。
 *
 * 注意: LiveKitRoom コンテキスト内（配信者レンダラ）から呼ぶこと。
 */
export function useShareKeepalive(): {
  startSharing: (deadlineMs?: number) => void;
  endSharing: () => void;
} {
  const { localParticipant } = useLocalParticipant();
  const lpRef = useRef(localParticipant);
  lpRef.current = localParticipant;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const originalTrackRef = useRef<MediaStreamTrack | null>(null);
  const drawIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  function getCameraTrack() {
    const lp = lpRef.current;
    if (!lp) return null;
    const pub = lp.getTrackPublication(Track.Source.Camera);
    return pub?.videoTrack ?? null;
  }

  const startSharing = useCallback((deadlineMs?: number) => {
    if (activeRef.current) return;
    const videoTrack = getCameraTrack();
    if (!videoTrack) return; // 接続前など: ベストエフォートで何もしない

    try {
      const W = 1280;
      const H = 720;
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        canvasRef.current = canvas;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const remaining = () =>
        deadlineMs != null
          ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000))
          : null;

      // 共有開始時点で「📱URL共有中」を描く。captureStream はこの最後のフレームを
      // 背景中も emit し続ける（合成経路と同じ仕組み）。
      drawSharingOverlay(ctx, W, H, remaining());
      const stream = canvas.captureStream();
      const canvasTrack = stream.getVideoTracks()[0];
      if (!canvasTrack) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      originalTrackRef.current = videoTrack.mediaStreamTrack;
      activeRef.current = true;

      // replaceTrack は非同期。共有シートが前景の間に完了させる。
      // userProvidedTrack=true で LiveKit が canvas トラックを停止/管理しないようにする。
      void videoTrack
        .replaceTrack(canvasTrack, { userProvidedTrack: true })
        .catch((e) => {
          console.error("[share-keepalive] replaceTrack(canvas) 失敗:", e);
        });

      // 前景の間はカウントダウンを更新（背景では描画ループが止まり最後のフレームが固定）。
      if (deadlineMs != null) {
        drawIntervalRef.current = setInterval(() => {
          if (!activeRef.current) return;
          const r = remaining();
          drawSharingOverlay(ctx, W, H, r);
          if (r === 0 && drawIntervalRef.current) {
            clearInterval(drawIntervalRef.current);
            drawIntervalRef.current = null;
          }
        }, 1000);
      }
    } catch (e) {
      console.error("[share-keepalive] startSharing 失敗:", e);
    }
  }, []);

  const endSharing = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (drawIntervalRef.current) {
      clearInterval(drawIntervalRef.current);
      drawIntervalRef.current = null;
    }

    const videoTrack = getCameraTrack();
    const original = originalTrackRef.current;

    (async () => {
      try {
        if (videoTrack) {
          if (original && original.readyState === "live") {
            // 元のカメラトラックに戻す（以降は LiveKit が管理する）。
            await videoTrack.replaceTrack(original, { userProvidedTrack: false });
          } else {
            // 背景中にカメラトラックが終了していた場合は取り直す。
            const fresh = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: "environment",
                width: 1280,
                height: 720,
                frameRate: 30,
              },
              audio: false,
            });
            const freshTrack = fresh.getVideoTracks()[0];
            if (freshTrack) {
              await videoTrack.replaceTrack(freshTrack, { userProvidedTrack: false });
            }
          }
        }
      } catch (e) {
        console.error("[share-keepalive] endSharing 復帰失敗:", e);
      } finally {
        // 共有用 canvas stream を停止（カメラトラックは停止しない）。
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        originalTrackRef.current = null;
      }
    })();
  }, []);

  return { startSharing, endSharing };
}
