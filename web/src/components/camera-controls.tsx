"use client";

import { useEffect, useState } from "react";
import type {
  CameraInfo,
  ZoomCapability,
} from "@/lib/use-composite-broadcast-track";

type Props = {
  availableCameras: CameraInfo[];
  currentCameraId: string | null;
  onSwitchCamera: (deviceId: string) => void;
  zoomCapability: ZoomCapability | null;
  currentZoom: number | null;
  onSetZoom: (zoom: number) => Promise<void>;
};

export function CameraControls({
  availableCameras,
  currentCameraId,
  onSwitchCamera,
  zoomCapability,
  currentZoom,
  onSetZoom,
}: Props) {
  const [zoomExpanded, setZoomExpanded] = useState(false);
  const [zoomDraft, setZoomDraft] = useState<number | null>(currentZoom);

  // 親側 zoom 変更（カメラ切替時のリセット等）と同期
  useEffect(() => {
    setZoomDraft(currentZoom);
  }, [currentZoom]);

  const showLensSwitcher = availableCameras.length >= 2;
  const showZoom =
    !!zoomCapability && zoomCapability.max > zoomCapability.min;

  if (!showLensSwitcher && !showZoom) {
    return null;
  }

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[2] flex flex-col items-center gap-2"
      role="group"
      aria-label="カメラ操作"
    >
      {showZoom && zoomExpanded && zoomCapability && (
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
          <span className="text-[10px] text-gray-300 tabular-nums w-8 text-right">
            {zoomDraft != null ? `${zoomDraft.toFixed(1)}x` : "-"}
          </span>
          <input
            type="range"
            min={zoomCapability.min}
            max={zoomCapability.max}
            step={zoomCapability.step || 0.1}
            value={zoomDraft ?? zoomCapability.min}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoomDraft(v);
              onSetZoom(v).catch(() => {});
            }}
            className="w-40 accent-[#e63946]"
            aria-label="ズーム倍率"
          />
          <button
            type="button"
            onClick={() => setZoomExpanded(false)}
            className="text-[10px] text-gray-400 hover:text-white"
            aria-label="ズームスライダーを閉じる"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-1.5 py-1">
        {showLensSwitcher &&
          availableCameras.map((cam) => {
            const active = cam.deviceId === currentCameraId;
            const label = cam.focalLabel != null ? `${cam.focalLabel}x` : "•";
            return (
              <button
                key={cam.deviceId}
                type="button"
                onClick={() => onSwitchCamera(cam.deviceId)}
                aria-pressed={active}
                aria-label={`レンズ ${cam.label || label}`}
                className={`min-w-[34px] h-7 px-2 rounded-full text-[11px] font-semibold tabular-nums transition-colors ${
                  active
                    ? "bg-white text-black"
                    : "bg-transparent text-gray-200 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            );
          })}

        {showZoom && (
          <button
            type="button"
            onClick={() => setZoomExpanded((v) => !v)}
            aria-label="ズームスライダーを開く"
            aria-expanded={zoomExpanded}
            className={`min-w-[34px] h-7 px-2 rounded-full text-[11px] font-semibold transition-colors ${
              zoomExpanded
                ? "bg-white text-black"
                : "bg-transparent text-gray-200 hover:bg-white/10"
            }`}
          >
            🔍
          </button>
        )}
      </div>
    </div>
  );
}
