"use client";

import { useWakeLock } from "@/lib/use-wake-lock";
import { useBattery } from "@/lib/use-battery";

const LOW_BATTERY_THRESHOLD = 0.2;
const CRITICAL_BATTERY_THRESHOLD = 0.1;

/**
 * 配信中の端末ヘルス警告バッジ。
 *
 * - **Wake Lock**: 取得失敗 / OS 解放時に「画面ロック注意」を表示
 *   - フック自体もこのコンポーネントが取得・保持する（マウント中のみ有効）
 * - **電池**: 充電していない状態で 20% 未満なら警告、10% 未満は危険色
 *   - Battery API 非対応端末（iPhone Safari 等）では何も表示しない
 *
 * 視聴者には焼き込まれず、配信者のローカル UI にのみ表示。
 * 焼き込み画像（左上スコア・右上試合名・左下経過時間）と被らない右下に配置。
 */
export function BroadcastHealthBadges() {
  const wakeLock = useWakeLock(true);
  const battery = useBattery(true);

  const showWakeLockWarn =
    wakeLock.status === "error" || wakeLock.status === "released";

  const batteryPct =
    battery.level !== null ? Math.floor(battery.level * 100) : null;
  const showBatteryWarn =
    battery.level !== null &&
    battery.charging === false &&
    battery.level < LOW_BATTERY_THRESHOLD;
  const isBatteryCritical =
    battery.level !== null && battery.level < CRITICAL_BATTERY_THRESHOLD;

  if (!showWakeLockWarn && !showBatteryWarn) return null;

  return (
    <div
      className="absolute bottom-3 right-3 z-[2] flex flex-col items-end gap-1.5 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {showWakeLockWarn && (
        <div className="flex items-center gap-1.5 bg-amber-900/90 backdrop-blur-sm border border-amber-500/50 rounded-full px-2.5 py-1 text-[10px] text-amber-100 font-medium shadow">
          <span aria-hidden="true">🔒</span>
          <span>
            {wakeLock.status === "released"
              ? "スリープ抑止が解除されました"
              : "画面ロック抑止に失敗"}
          </span>
        </div>
      )}
      {showBatteryWarn && batteryPct !== null && (
        <div
          className={`flex items-center gap-1.5 backdrop-blur-sm border rounded-full px-2.5 py-1 text-[10px] font-medium shadow ${
            isBatteryCritical
              ? "bg-red-900/90 border-red-500/60 text-red-100"
              : "bg-amber-900/90 border-amber-500/50 text-amber-100"
          }`}
        >
          <span aria-hidden="true">🔋</span>
          <span>
            電池 {batteryPct}%
            {isBatteryCritical ? "（充電してください）" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
