"use client";

import { useEffect, useMemo, useState } from "react";
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

// iPhone は 1 つの「Back Camera」を OS が hardware 切替する仕様のため、
// deviceId 単位ではなく「zoom 値プリセット」でレンズ感覚を与える。
// zoomCapability が無い端末では deviceId switcher にフォールバックする。
function buildZoomPresets(cap: ZoomCapability): number[] {
  const presets: number[] = [];
  if (cap.min <= 0.5) presets.push(0.5);
  presets.push(Math.max(1, cap.min));
  if (cap.max >= 2) presets.push(2);
  if (cap.max >= 3) presets.push(3);
  if (cap.max >= 5) presets.push(5);
  return Array.from(new Set(presets)).sort((a, b) => a - b);
}

function findClosestPreset(
  presets: number[],
  current: number | null,
): number | null {
  if (current == null || presets.length === 0) return null;
  let closest = presets[0];
  let diff = Math.abs(current - closest);
  for (const p of presets) {
    const d = Math.abs(current - p);
    if (d < diff) {
      diff = d;
      closest = p;
    }
  }
  return closest;
}

function dedupCameras(cams: CameraInfo[]): CameraInfo[] {
  const seen = new Set<string>();
  return cams.filter((c) => {
    const key = c.label || c.deviceId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatZoomLabel(z: number): string {
  if (Number.isInteger(z)) return `${z}x`;
  return `${z.toFixed(1)}x`;
}

type ViewMode = "collapsed" | "presets" | "slider";

export function CameraControls({
  availableCameras,
  currentCameraId,
  onSwitchCamera,
  zoomCapability,
  currentZoom,
  onSetZoom,
}: Props) {
  const [view, setView] = useState<ViewMode>("collapsed");
  const [zoomDraft, setZoomDraft] = useState<number | null>(currentZoom);

  useEffect(() => {
    setZoomDraft(currentZoom);
  }, [currentZoom]);

  const zoomPresets = useMemo(
    () => (zoomCapability ? buildZoomPresets(zoomCapability) : []),
    [zoomCapability],
  );
  const activePreset = useMemo(
    () => findClosestPreset(zoomPresets, currentZoom),
    [zoomPresets, currentZoom],
  );
  const dedupedCams = useMemo(
    () => dedupCameras(availableCameras),
    [availableCameras],
  );

  const showZoomPresets = zoomPresets.length >= 2;
  const showCameraSwitcher = !showZoomPresets && dedupedCams.length >= 2;
  const showZoomSlider =
    !!zoomCapability && zoomCapability.max > zoomCapability.min;

  // 何も出すものがなければ非表示
  if (!showZoomPresets && !showCameraSwitcher && !showZoomSlider) {
    return null;
  }

  // 折りたたんだ表示用ラベル: 現在のズーム値（プリセットがあればそれ、なければ "🔍"）
  const collapsedLabel = activePreset != null
    ? formatZoomLabel(activePreset)
    : currentZoom != null
      ? formatZoomLabel(currentZoom)
      : null;

  return (
    <div
      className="absolute top-14 left-3 sm:top-16 sm:left-4 z-[2] flex items-center"
      role="group"
      aria-label="カメラ操作"
    >
      {view === "collapsed" && (
        <button
          type="button"
          onClick={() => setView("presets")}
          aria-label="カメラ操作を開く"
          aria-expanded={false}
          className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm text-gray-100 hover:bg-black/80 active:scale-95 transition-all flex items-center justify-center text-[12px] font-semibold tabular-nums shadow-lg ring-1 ring-white/10"
        >
          {collapsedLabel ?? (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M11 17a6 6 0 100-12 6 6 0 000 12z"
              />
            </svg>
          )}
        </button>
      )}

      {view === "presets" && (
        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-1.5 py-1 h-10 shadow-lg ring-1 ring-white/10">
          {showZoomPresets &&
            zoomPresets.map((z) => {
              const active = activePreset === z;
              return (
                <button
                  key={z}
                  type="button"
                  onClick={() => {
                    setZoomDraft(z);
                    onSetZoom(z).catch(() => {});
                    setView("collapsed");
                  }}
                  aria-pressed={active}
                  aria-label={`${formatZoomLabel(z)} ズーム`}
                  className={`min-w-[40px] h-8 px-2 rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
                    active
                      ? "bg-white text-black"
                      : "bg-transparent text-gray-200 hover:bg-white/10"
                  }`}
                >
                  {formatZoomLabel(z)}
                </button>
              );
            })}

          {showCameraSwitcher &&
            dedupedCams.map((cam, idx) => {
              const active = cam.deviceId === currentCameraId;
              const label =
                cam.focalLabel != null
                  ? formatZoomLabel(cam.focalLabel)
                  : `Cam ${idx + 1}`;
              return (
                <button
                  key={cam.deviceId}
                  type="button"
                  onClick={() => {
                    onSwitchCamera(cam.deviceId);
                    setView("collapsed");
                  }}
                  aria-pressed={active}
                  aria-label={`レンズ ${cam.label || label}`}
                  className={`min-w-[40px] h-8 px-2 rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
                    active
                      ? "bg-white text-black"
                      : "bg-transparent text-gray-200 hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              );
            })}

          {showZoomSlider && (
            <button
              type="button"
              onClick={() => setView("slider")}
              aria-label="ズームスライダーを開く"
              className="min-w-[34px] h-8 px-2 rounded-full text-[12px] font-semibold text-gray-200 hover:bg-white/10 transition-colors"
            >
              🔍
            </button>
          )}

          <button
            type="button"
            onClick={() => setView("collapsed")}
            aria-label="カメラ操作を閉じる"
            className="min-w-[28px] h-8 px-1.5 rounded-full text-[12px] font-semibold text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {view === "slider" && zoomCapability && (
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 h-10 shadow-lg ring-1 ring-white/10">
          <span className="text-[11px] text-gray-200 tabular-nums w-10 text-right">
            {zoomDraft != null ? formatZoomLabel(zoomDraft) : "-"}
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
            onClick={() => setView("collapsed")}
            className="text-[12px] text-gray-300 hover:text-white w-5 text-center"
            aria-label="ズームスライダーを閉じる"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
