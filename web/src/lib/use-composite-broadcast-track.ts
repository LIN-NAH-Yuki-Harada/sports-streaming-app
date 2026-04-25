"use client";

import { useEffect, useRef, useState } from "react";
import {
  drawScoreboard,
  type ScoreboardState,
} from "@/lib/scoreboard-canvas";

type Resolution = { width: number; height: number; frameRate: number };

type Status = "idle" | "acquiring" | "ready" | "error";

type UseCompositeBroadcastTrackArgs = {
  state: ScoreboardState;
  targetResolution: Resolution;
  enabled: boolean;
};

type UseCompositeBroadcastTrackResult = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoTrack: MediaStreamTrack | null;
  status: Status;
  error: Error | null;
};

type RVFCHandle = number;

type VideoElementWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => RVFCHandle;
  cancelVideoFrameCallback?: (handle: RVFCHandle) => void;
};

export function useCompositeBroadcastTrack({
  state,
  targetResolution,
  enabled,
}: UseCompositeBroadcastTrackArgs): UseCompositeBroadcastTrackResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stateRef = useRef<ScoreboardState>(state);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<Error | null>(null);

  // state の最新値を ref にミラー（描画ループから参照）
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let cameraStream: MediaStream | null = null;
    let captureStream: MediaStream | null = null;
    let rvfcHandle: RVFCHandle | null = null;
    let rafHandle: number | null = null;
    let resizeHandler: (() => void) | null = null;
    const coverRect = { sx: 0, sy: 0, sw: 0, sh: 0 };

    async function start() {
      setStatus("acquiring");
      setError(null);

      try {
        // 音声は LiveKitRoom の audio={true} 経由で auto-publish させる（枯れたコードパス）。
        // ここでは video 専用ストリームのみ取得して Canvas 合成に使う。
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: targetResolution.width },
            height: { ideal: targetResolution.height },
            frameRate: { ideal: targetResolution.frameRate },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        cameraStream = stream;

        const videoEl = videoRef.current as VideoElementWithRVFC | null;
        const canvasEl = canvasRef.current;
        if (!videoEl || !canvasEl) {
          throw new Error("video/canvas ref が未アタッチです");
        }
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {
          // play() が失敗する場合があるが、 srcObject 設定だけでも動くケースが多い
        });

        canvasEl.width = targetResolution.width;
        canvasEl.height = targetResolution.height;
        const ctx = canvasEl.getContext("2d", { alpha: false });
        if (!ctx) {
          throw new Error("2d context が取得できませんでした");
        }

        function recomputeCoverRect() {
          const vw = videoEl!.videoWidth;
          const vh = videoEl!.videoHeight;
          if (!vw || !vh) return;
          const canvasAspect = targetResolution.width / targetResolution.height;
          const videoAspect = vw / vh;
          if (videoAspect > canvasAspect) {
            // 映像が横長 → 左右をクロップ
            coverRect.sh = vh;
            coverRect.sw = Math.round(vh * canvasAspect);
            coverRect.sy = 0;
            coverRect.sx = Math.round((vw - coverRect.sw) / 2);
          } else {
            // 映像が縦長 → 上下をクロップ
            coverRect.sw = vw;
            coverRect.sh = Math.round(vw / canvasAspect);
            coverRect.sx = 0;
            coverRect.sy = Math.round((vh - coverRect.sh) / 2);
          }
        }

        resizeHandler = recomputeCoverRect;
        videoEl.addEventListener("resize", recomputeCoverRect);
        videoEl.addEventListener("loadedmetadata", recomputeCoverRect);
        recomputeCoverRect();

        function renderFrame() {
          if (cancelled) return;
          if (!videoEl || videoEl.readyState < 2) {
            scheduleNext();
            return;
          }
          if (!coverRect.sw || !coverRect.sh) {
            recomputeCoverRect();
          }
          try {
            if (coverRect.sw && coverRect.sh) {
              ctx!.drawImage(
                videoEl,
                coverRect.sx,
                coverRect.sy,
                coverRect.sw,
                coverRect.sh,
                0,
                0,
                targetResolution.width,
                targetResolution.height,
              );
            } else {
              ctx!.fillStyle = "#000";
              ctx!.fillRect(0, 0, targetResolution.width, targetResolution.height);
            }
            drawScoreboard(
              ctx!,
              stateRef.current,
              targetResolution.width,
              targetResolution.height,
            );
          } catch (e) {
            console.error("[composite] 描画エラー:", e);
          }
          scheduleNext();
        }

        function scheduleNext() {
          if (cancelled) return;
          if (typeof videoEl!.requestVideoFrameCallback === "function") {
            rvfcHandle = videoEl!.requestVideoFrameCallback(renderFrame);
          } else {
            rafHandle = window.requestAnimationFrame(renderFrame);
          }
        }

        // 最初の 1 フレームを描画してから captureStream を呼ぶ（0x0 track 回避）
        renderFrame();

        const cs = canvasEl.captureStream(targetResolution.frameRate);
        captureStream = cs;
        const vt = cs.getVideoTracks()[0] ?? null;
        if (!vt) {
          throw new Error("Canvas の MediaStreamTrack を取得できませんでした");
        }

        if (cancelled) {
          cs.getTracks().forEach((t) => t.stop());
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setVideoTrack(vt);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        console.error("[composite] 初期化エラー:", err);
        setError(err);
        setStatus("error");
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rvfcHandle !== null) {
        const videoEl = videoRef.current as VideoElementWithRVFC | null;
        videoEl?.cancelVideoFrameCallback?.(rvfcHandle);
      }
      if (rafHandle !== null) {
        window.cancelAnimationFrame(rafHandle);
      }
      if (resizeHandler && videoRef.current) {
        videoRef.current.removeEventListener("resize", resizeHandler);
        videoRef.current.removeEventListener("loadedmetadata", resizeHandler);
      }
      if (captureStream) {
        captureStream.getTracks().forEach((t) => t.stop());
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setVideoTrack(null);
      setStatus("idle");
    };
    // targetResolution の各値は安定していることが前提。再取得を避けるため個別依存にせず JSON で比較
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    targetResolution.width,
    targetResolution.height,
    targetResolution.frameRate,
  ]);

  return { canvasRef, videoRef, videoTrack, status, error };
}
