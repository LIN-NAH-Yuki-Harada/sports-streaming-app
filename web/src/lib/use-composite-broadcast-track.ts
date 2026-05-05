"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  drawScoreboard,
  type ScoreboardState,
} from "@/lib/scoreboard-canvas";

type Resolution = { width: number; height: number; frameRate: number };

type Status = "idle" | "acquiring" | "ready" | "error";

export type LensType = "ultra-wide" | "wide" | "telephoto" | "unknown";

export type CameraInfo = {
  deviceId: string;
  label: string;
  lensType: LensType;
  // 表示用の倍率ラベル（0.5x / 1x / 2x など）。判定不能なら null
  focalLabel: number | null;
};

export type ZoomCapability = {
  min: number;
  max: number;
  step: number;
};

type UseCompositeBroadcastTrackArgs = {
  state: ScoreboardState;
  targetResolution: Resolution;
  enabled: boolean;
  // 配信者が LINE 等で URL を共有中（Safari バックグラウンド）に
  // 視聴者画面が黒くならないよう、カメラ映像の代わりに「共有中」
  // オーバーレイを canvas に描画するフラグ。
  isSharing?: boolean;
};

type UseCompositeBroadcastTrackResult = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoTrack: MediaStreamTrack | null;
  status: Status;
  error: Error | null;
  // カメラ制御（5/05 追加: 広角/ズーム対応）
  availableCameras: CameraInfo[];
  currentCameraId: string | null;
  switchCamera: (deviceId: string) => void;
  zoomCapability: ZoomCapability | null;
  currentZoom: number | null;
  setZoom: (zoom: number) => Promise<void>;
};

type RVFCHandle = number;

/**
 * 配信者が LINE 等で URL を共有中（Safari バックグラウンド）に
 * 視聴者画面に出すフォールバックオーバーレイ。
 *
 * iOS Safari は他アプリ起動でバックグラウンドに入ると JS / camera が
 * 停止するが、canvas.captureStream は最後に描画されたフレームを
 * 出し続けるため、共有開始時点でこの絵を canvas に焼いておけば
 * 視聴者には黒画面ではなく案内メッセージが見える。
 *
 * 1080p (1920x1080) を想定したサイズ。スマホ視聴で縮小されても
 * 読めるよう大きめのフォントで描画する。
 */
function drawSharingOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  // 完全に黒で塗りつぶし（凍ったカメラフレームが見えると混乱するため）
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // 大きいアイコン（emoji）
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "160px sans-serif";
  ctx.fillText("📱", cx, cy - 140);

  // メインメッセージ
  ctx.font = "bold 72px sans-serif";
  ctx.fillText("配信者がLINEでURLを共有中です", cx, cy + 30);

  // サブメッセージ
  ctx.fillStyle = "#bbbbbb";
  ctx.font = "44px sans-serif";
  ctx.fillText("チームに案内を送っています", cx, cy + 110);
  ctx.fillText("しばらくお待ちください...", cx, cy + 170);
}

function scoreboardKey(s: ScoreboardState): string {
  return [
    s.home_team,
    s.away_team,
    s.home_score,
    s.away_score,
    s.home_sets,
    s.away_sets,
    s.period,
    s.tournament ?? "",
    s.sport,
    s.pointLabel ?? "",
    s.elapsedSeconds ?? "",
  ].join("|");
}

type VideoElementWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => RVFCHandle;
  cancelVideoFrameCallback?: (handle: RVFCHandle) => void;
};

// MediaTrackCapabilities / Constraints の zoom は標準型に未収録（W3C Image Capture API 拡張）
type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number };
};
type ZoomSettings = MediaTrackSettings & { zoom?: number };
type ZoomAdvancedConstraint = MediaTrackConstraintSet & { zoom?: number };

function parseLens(label: string): { type: LensType; focal: number | null } {
  const lower = label.toLowerCase();
  // フロント / ユーザー向きカメラは除外対象（戻り値は呼び出し側で判断）
  if (lower.includes("ultra wide") || lower.includes("ultrawide") || lower.includes("ultra-wide")) {
    return { type: "ultra-wide", focal: 0.5 };
  }
  if (lower.includes("telephoto")) {
    // iPhone は 2x / 3x が混在するのでラベル内の数字を優先的に拾う
    const m = label.match(/(\d+(?:\.\d+)?)\s*x/i);
    return { type: "telephoto", focal: m ? Number(m[1]) : 2 };
  }
  if (
    lower.includes("back") ||
    lower.includes("environment") ||
    lower.includes("rear") ||
    lower.includes("背面") ||
    lower.includes("外側")
  ) {
    return { type: "wide", focal: 1 };
  }
  return { type: "unknown", focal: null };
}

function isFrontCamera(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower.includes("front") ||
    lower.includes("user") ||
    lower.includes("face") ||
    lower.includes("前面") ||
    lower.includes("内側") ||
    lower.includes("インカメラ")
  );
}

export function useCompositeBroadcastTrack({
  state,
  targetResolution,
  enabled,
  isSharing = false,
}: UseCompositeBroadcastTrackArgs): UseCompositeBroadcastTrackResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stateRef = useRef<ScoreboardState>(state);
  // renderFrame closure で参照するため ref 経由（state 直接参照だと再レンダ
  // 後の closure が古くて反映が遅れる）
  const isSharingRef = useRef(isSharing);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const lastOverlayKeyRef = useRef<string>("");
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<Error | null>(null);

  // カメラ制御 state
  const [availableCameras, setAvailableCameras] = useState<CameraInfo[]>([]);
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null);
  const [zoomCapability, setZoomCapability] = useState<ZoomCapability | null>(
    null,
  );
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);

  // state の最新値を ref にミラー
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // isSharing の最新値を ref にミラー（renderFrame closure 用）
  useEffect(() => {
    isSharingRef.current = isSharing;
  }, [isSharing]);

  // オフスクリーン overlay canvas
  useEffect(() => {
    if (!enabled) return;
    const overlay = document.createElement("canvas");
    overlay.width = targetResolution.width;
    overlay.height = targetResolution.height;
    const ctx = overlay.getContext("2d");
    if (ctx) {
      drawScoreboard(ctx, stateRef.current, overlay.width, overlay.height);
      lastOverlayKeyRef.current = scoreboardKey(stateRef.current);
    }
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      lastOverlayKeyRef.current = "";
    };
  }, [enabled, targetResolution.width, targetResolution.height]);

  // state 変化時にだけ overlay を再描画
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const key = scoreboardKey(state);
    if (key === lastOverlayKeyRef.current) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawScoreboard(ctx, state, overlay.width, overlay.height);
    lastOverlayKeyRef.current = key;
  }, [state]);

  // カメラ取得 — currentCameraId 変更時に再実行（pipeline は維持）
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let acquiredStream: MediaStream | null = null;

    async function acquire() {
      setStatus("acquiring");
      setError(null);
      try {
        const videoConstraints: MediaTrackConstraints = currentCameraId
          ? {
              deviceId: { exact: currentCameraId },
              width: { ideal: targetResolution.width },
              height: { ideal: targetResolution.height },
              frameRate: { ideal: targetResolution.frameRate },
            }
          : {
              facingMode: "environment",
              width: { ideal: targetResolution.width },
              height: { ideal: targetResolution.height },
              frameRate: { ideal: targetResolution.frameRate },
            };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // 旧ストリームを停止してから新しいものに差し替え
        const prev = cameraStreamRef.current;
        if (prev) {
          prev.getTracks().forEach((t) => t.stop());
        }
        cameraStreamRef.current = stream;
        acquiredStream = stream;

        const videoEl = videoRef.current as VideoElementWithRVFC | null;
        if (!videoEl) {
          throw new Error("video ref が未アタッチです");
        }
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});

        // facingMode で初回取得した場合、確定 deviceId を currentCameraId に反映
        const settings = stream.getVideoTracks()[0]?.getSettings();
        if (!currentCameraId && settings?.deviceId) {
          setCurrentCameraId(settings.deviceId);
        }

        // ズーム capability を確認
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === "function") {
          const caps = track.getCapabilities() as ZoomCapabilities;
          if (caps.zoom) {
            setZoomCapability({
              min: caps.zoom.min,
              max: caps.zoom.max,
              step: caps.zoom.step,
            });
            const cur = (track.getSettings() as ZoomSettings).zoom ?? caps.zoom.min;
            setCurrentZoom(cur);
          } else {
            setZoomCapability(null);
            setCurrentZoom(null);
          }
        }

        // 取得完了。pipeline 側の "ready" と整合させるため明示的にも立てる。
        // currentCameraId が後から確定すると effect が再実行されて "acquiring"
        // のままになる事象（5/05 報告）を防止。
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        console.error("[composite] camera 取得エラー:", err);
        setError(err);
        setStatus("error");
      }
    }

    acquire();

    return () => {
      cancelled = true;
      if (acquiredStream && cameraStreamRef.current === acquiredStream) {
        acquiredStream.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
    };
  }, [
    enabled,
    currentCameraId,
    targetResolution.width,
    targetResolution.height,
    targetResolution.frameRate,
  ]);

  // Canvas パイプライン — enabled / 解像度のみで再構築（カメラ切替では維持される）
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let captureStream: MediaStream | null = null;
    let rvfcHandle: RVFCHandle | null = null;
    let rafHandle: number | null = null;
    let resizeHandler: (() => void) | null = null;
    const coverRect = { sx: 0, sy: 0, sw: 0, sh: 0 };

    async function start() {
      try {
        const videoEl = videoRef.current as VideoElementWithRVFC | null;
        const canvasEl = canvasRef.current;
        if (!videoEl || !canvasEl) {
          throw new Error("video/canvas ref が未アタッチです");
        }

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
            coverRect.sh = vh;
            coverRect.sw = Math.round(vh * canvasAspect);
            coverRect.sy = 0;
            coverRect.sx = Math.round((vw - coverRect.sw) / 2);
          } else {
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
            if (isSharingRef.current) {
              // 共有中オーバーレイ（カメラ映像の代わり）。
              // iOS Safari バックグラウンドで JS が停止しても、canvas の
              // 最後のフレーム = この絵 が captureStream から出続けるため
              // 視聴者には黒ではなく「URL 共有中」が見え続ける。
              drawSharingOverlay(
                ctx!,
                targetResolution.width,
                targetResolution.height,
              );
            } else if (coverRect.sw && coverRect.sh) {
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
            const overlay = overlayRef.current;
            if (overlay) {
              ctx!.drawImage(overlay, 0, 0);
            } else {
              drawScoreboard(
                ctx!,
                stateRef.current,
                targetResolution.width,
                targetResolution.height,
              );
            }
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

        // 重要: captureStream は「実映像が canvas に描画された後」に作る。
        //
        // 5/05 PR #109 のリファクタで camera 取得とパイプラインを別 effect に
        // 分離した結果、空 canvas から captureStream を作って LiveKit に publish
        // していた。エンコーダ（VP8/H264）は最初の数秒で bitrate / 量子化を学習
        // するため、黒フレームで「低 bitrate でよい」と固定され、後から実映像が
        // 来てもブロックノイズが残る画質劣化が発生していた（5/03 配信より荒い）。
        //
        // ここで video element に最初の実フレームが届くまで明示的に待ち、
        // renderFrame() で 1 フレーム描画してから captureStream を作る。
        if (videoEl.readyState < 2 || !videoEl.videoWidth) {
          await new Promise<void>((resolve) => {
            let pollHandle: number | null = null;

            function check() {
              if (cancelled) {
                cleanup();
                resolve();
                return;
              }
              if (videoEl!.readyState >= 2 && videoEl!.videoWidth > 0) {
                cleanup();
                resolve();
              }
            }

            function cleanup() {
              window.clearTimeout(timer);
              if (pollHandle !== null) {
                window.clearInterval(pollHandle);
              }
              videoEl!.removeEventListener("loadedmetadata", check);
              videoEl!.removeEventListener("loadeddata", check);
              videoEl!.removeEventListener("canplay", check);
              videoEl!.removeEventListener("playing", check);
            }

            const timer = window.setTimeout(() => {
              cleanup();
              resolve();
            }, 30_000);

            // 200ms 間隔のポーリング（cancelled / 権限拒否でハングしないため）
            pollHandle = window.setInterval(check, 200);

            videoEl!.addEventListener("loadedmetadata", check);
            videoEl!.addEventListener("loadeddata", check);
            videoEl!.addEventListener("canplay", check);
            videoEl!.addEventListener("playing", check);
            check(); // mount タイミングですでに ready なケース
          });
        }

        if (cancelled) return;

        // recomputeCoverRect は videoEl.videoWidth/Height が確定してから呼ぶ
        recomputeCoverRect();

        // 実映像から最初のフレームを描画
        renderFrame();

        const cs = canvasEl.captureStream(targetResolution.frameRate);
        captureStream = cs;
        const vt = cs.getVideoTracks()[0] ?? null;
        if (!vt) {
          throw new Error("Canvas の MediaStreamTrack を取得できませんでした");
        }

        if (cancelled) {
          cs.getTracks().forEach((t) => t.stop());
          return;
        }

        setVideoTrack(vt);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        console.error("[composite] pipeline 初期化エラー:", err);
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
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      // カメラストリームは別 effect で管理
      const cam = cameraStreamRef.current;
      if (cam) {
        cam.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      setVideoTrack(null);
      setStatus("idle");
    };
  }, [
    enabled,
    targetResolution.width,
    targetResolution.height,
    targetResolution.frameRate,
  ]);

  // カメラ列挙 — 初回取得後（permission 取得後）に label が埋まる
  useEffect(() => {
    if (!enabled) return;
    if (!currentCameraId) return; // 1 度カメラ取得が成功してから列挙

    let cancelled = false;

    async function enumerate() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        const cams: CameraInfo[] = [];
        for (const d of devices) {
          if (d.kind !== "videoinput") continue;
          if (isFrontCamera(d.label)) continue; // フロントカメラは除外
          const { type, focal } = parseLens(d.label);
          cams.push({
            deviceId: d.deviceId,
            label: d.label,
            lensType: type,
            focalLabel: focal,
          });
        }

        // 焦点距離の昇順（0.5x → 1x → 2x → unknown 末尾）
        cams.sort((a, b) => {
          if (a.focalLabel === null && b.focalLabel === null) return 0;
          if (a.focalLabel === null) return 1;
          if (b.focalLabel === null) return -1;
          return a.focalLabel - b.focalLabel;
        });

        setAvailableCameras(cams);
      } catch (e) {
        console.error("[composite] enumerateDevices エラー:", e);
      }
    }

    enumerate();

    // デバイス着脱で再列挙
    const onDeviceChange = () => enumerate();
    navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [enabled, currentCameraId]);

  const switchCamera = useCallback((deviceId: string) => {
    setCurrentCameraId(deviceId);
    // ズームは新カメラの capability に依存するので一旦リセット（acquire 内で再設定される）
    setZoomCapability(null);
    setCurrentZoom(null);
  }, []);

  const setZoom = useCallback(async (zoom: number) => {
    const stream = cameraStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track || typeof track.applyConstraints !== "function") return;
    try {
      const advanced: ZoomAdvancedConstraint[] = [{ zoom }];
      await track.applyConstraints({ advanced } as MediaTrackConstraints);
      setCurrentZoom(zoom);
    } catch (e) {
      console.error("[composite] zoom applyConstraints エラー:", e);
    }
  }, []);

  return {
    canvasRef,
    videoRef,
    videoTrack,
    status,
    error,
    availableCameras,
    currentCameraId,
    switchCamera,
    zoomCapability,
    currentZoom,
    setZoom,
  };
}
