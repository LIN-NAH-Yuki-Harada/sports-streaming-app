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
// zoomCapability が無い端末（Android で getCapabilities が zoom を返さない等）
// では deviceId switcher にフォールバックする。
function buildZoomPresets(cap: ZoomCapability): number[] {
  const presets: number[] = [];
  if (cap.min <= 0.5) presets.push(0.5);
  // 1x は常に出す（min が 1 ならその値、それ以外でも 1 固定で OK）
  presets.push(Math.max(1, cap.min));
  if (cap.max >= 2) presets.push(2);
  if (cap.max >= 3) presets.push(3);
  if (cap.max >= 5) presets.push(5);
  // 重複除去
  return Array.from(new Set(presets)).sort((a, b) => a - b);
}

function findClosestPreset(presets: number[], current: number | null): number | null {
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
  // 整数なら "2x"、小数なら "0.5x" / "1.5x"
  if (Number.isInteger(z)) return `${z}x`;
  return `${z.toFixed(1)}x`;
}

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

  // 配置は得点の更に下、配信終了ボタン列の上のスペース。
  // ピル ↔ スライダーは「その場で置き換え」する（高さ・位置不変）。
  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[2] flex items-center"
      role="group"
      aria-label="カメラ操作"
    >
      {showZoomSlider && zoomExpanded && zoomCapability ? (
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 h-9">
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
            className="w-44 accent-[#e63946]"
            aria-label="ズーム倍率"
          />
          <button
            type="button"
            onClick={() => setZoomExpanded(false)}
            className="text-[12px] text-gray-300 hover:text-white w-5 text-center"
            aria-label="ズームスライダーを閉じる"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-1.5 py-1 h-9">
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
                  }}
                  aria-pressed={active}
                  aria-label={`${formatZoomLabel(z)} ズーム`}
                  className={`min-w-[40px] h-7 px-2 rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
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
                  onClick={() => onSwitchCamera(cam.deviceId)}
                  aria-pressed={active}
                  aria-label={`レンズ ${cam.label || label}`}
                  className={`min-w-[40px] h-7 px-2 rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
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
              onClick={() => setZoomExpanded(true)}
              aria-label="ズームスライダーを開く"
              aria-expanded={zoomExpanded}
              className="min-w-[34px] h-7 px-2 rounded-full text-[12px] font-semibold text-gray-200 hover:bg-white/10 transition-colors"
            >
              🔍
            </button>
          )}
        </div>
      )}
    </div>
  );
}
