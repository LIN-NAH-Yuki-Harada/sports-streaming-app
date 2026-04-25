"use client";

import { useEffect, useRef, useState } from "react";

type WakeLockStatus =
  | "unsupported"
  | "acquiring"
  | "active"
  | "released"
  | "error";

type Result = {
  status: WakeLockStatus;
  /** API がサポートされていない端末か */
  isUnsupported: boolean;
};

/**
 * Screen Wake Lock を保持するフック。
 *
 * - マウント時に取得を試み、成功したら保持し続ける
 * - iOS/Android はタブ非表示時に Wake Lock を自動解放するため、
 *   `visibilitychange` で可視に戻ったら**再取得**する
 * - `release` イベントを監視して、OS による解放後の再取得もハンドル
 * - アンマウント時に明示的に release
 *
 * 配信中はこのフックを呼んでいる限り、配信ページが手前にある間は
 * 画面ロック・自動スリープが起きない。
 */
export function useWakeLock(enabled: boolean = true): Result {
  const [status, setStatus] = useState<WakeLockStatus>(() =>
    typeof navigator !== "undefined" && "wakeLock" in navigator
      ? "acquiring"
      : "unsupported",
  );
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;

    async function acquire() {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      // 既に保持しているなら何もしない
      const existing = sentinelRef.current;
      if (existing && !existing.released) return;

      setStatus("acquiring");
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setStatus("active");
        sentinel.addEventListener("release", () => {
          // OS/ブラウザが解放した場合、ref をクリア。
          // 再取得は visibilitychange で行う。
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            if (!cancelled) setStatus("released");
          }
        });
      } catch (e) {
        if (!cancelled) {
          console.error("[wakeLock] 取得失敗:", e);
          setStatus("error");
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        // 可視に戻ったら必ず再取得を試みる
        acquire();
      }
    }

    acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      sentinel?.release().catch(() => {});
    };
  }, [enabled]);

  return {
    status,
    isUnsupported: status === "unsupported",
  };
}
