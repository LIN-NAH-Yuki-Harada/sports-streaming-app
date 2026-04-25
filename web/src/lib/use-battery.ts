"use client";

import { useEffect, useState } from "react";

type BatteryLike = {
  level: number;
  charging: boolean;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
};

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryLike>;
};

type Result = {
  /** 0〜1 の電池残量。取得不可端末では null */
  level: number | null;
  /** 充電中かどうか。取得不可端末では null */
  charging: boolean | null;
  /** Battery API 非対応（iPhone Safari 等） */
  isUnsupported: boolean;
};

/**
 * Battery Status API を購読するフック。
 *
 * - Chrome (Android/Desktop) 系はサポートあり
 * - iPhone Safari は非対応 → isUnsupported=true で返す（呼び出し側で warning を出さない）
 * - levelchange / chargingchange を購読してリアルタイム更新
 */
function detectInitialSupport(): boolean {
  if (typeof navigator === "undefined") return true; // SSR は中立に扱う
  return typeof (navigator as NavigatorWithBattery).getBattery === "function";
}

export function useBattery(enabled: boolean = true): Result {
  const [level, setLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState<boolean | null>(null);
  // 初期判定は useState の初期化関数で済ませる（effect 内同期 setState を避ける）。
  const [isUnsupported, setIsUnsupported] = useState(() => !detectInitialSupport());

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== "function") return;

    let cancelled = false;
    let battery: BatteryLike | null = null;
    const onLevelChange = () => {
      if (battery) setLevel(battery.level);
    };
    const onChargingChange = () => {
      if (battery) setCharging(battery.charging);
    };

    nav
      .getBattery!()
      .then((b) => {
        if (cancelled) return;
        battery = b;
        setLevel(b.level);
        setCharging(b.charging);
        b.addEventListener("levelchange", onLevelChange);
        b.addEventListener("chargingchange", onChargingChange);
      })
      .catch(() => {
        // Promise rejection 経由なので effect body の同期 setState ではない（ルール非該当）
        if (!cancelled) setIsUnsupported(true);
      });

    return () => {
      cancelled = true;
      if (battery) {
        battery.removeEventListener("levelchange", onLevelChange);
        battery.removeEventListener("chargingchange", onChargingChange);
      }
    };
  }, [enabled]);

  return { level, charging, isUnsupported };
}
