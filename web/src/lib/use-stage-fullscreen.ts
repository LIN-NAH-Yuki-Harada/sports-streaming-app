"use client";

import { useEffect, useRef, useState } from "react";

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type IOSVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

type Options = {
  /**
   * iPhone Safari 等で要素単位 Fullscreen API が使えないとき、
   * ステージ内の `<video>` 要素に対して `webkitEnterFullscreen()` を呼ぶ。
   * デフォルト true（視聴ページ向け）。配信ページのようにステージの主役が
   * canvas の場合は false にして、Fake Fullscreen に直接フォールバックする。
   */
  allowVideoFallback?: boolean;
};

/**
 * ステージ要素を全画面化するフック。
 *
 * 試行順序:
 *   1. element.requestFullscreen() — PC Chrome, Android Chrome, iPad Safari 16.4+
 *   2. element.webkitRequestFullscreen() — 旧プレフィックス
 *   3. video.webkitEnterFullscreen() — iPhone Safari, iPad Safari < 16.4
 *      （`allowVideoFallback=true` のときのみ。スコアボードが映像に焼き込まれているので
 *       iOS ネイティブ動画プレイヤーでも見える）
 *   4. Fake Fullscreen — 上記すべてが使えない or 失敗した場合
 */
export function useStageFullscreen<T extends HTMLElement = HTMLDivElement>(
  options: Options = {},
) {
  const { allowVideoFallback = true } = options;
  const stageRef = useRef<T | null>(null);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);

  // ネイティブ全画面状態を追従（ESC・iOS のスワイプ離脱に対応）。
  // 解除直後にステージ内の <video> が一時停止することがあるので resume を複数回 retry する。
  useEffect(() => {
    const doc = document as FullscreenDocument;
    const handler = () => {
      const active = doc.fullscreenElement || doc.webkitFullscreenElement;
      setIsNativeFullscreen(Boolean(active));
      if (!active) {
        // iOS は webkitendfullscreen 後にも一時停止状態が残ることがあるため
        // 複数のタイミングで play() を試行（即時 / 100ms / 500ms）
        const tryPlay = () => {
          const video = stageRef.current?.querySelector("video") as
            | HTMLVideoElement
            | null;
          video?.play().catch(() => {});
        };
        tryPlay();
        setTimeout(tryPlay, 100);
        setTimeout(tryPlay, 500);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  // フェイク全画面中は ESC キーで解除
  useEffect(() => {
    if (!isFakeFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFakeFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFakeFullscreen]);

  async function toggleFullscreen() {
    const stage = stageRef.current as FullscreenElement | null;
    if (!stage) return;
    const doc = document as FullscreenDocument;
    const activeNative = doc.fullscreenElement || doc.webkitFullscreenElement;

    if (activeNative) {
      try {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } catch {}
      return;
    }
    if (isFakeFullscreen) {
      setIsFakeFullscreen(false);
      return;
    }

    try {
      if (stage.requestFullscreen) {
        await stage.requestFullscreen();
        return;
      }
      if (stage.webkitRequestFullscreen) {
        await stage.webkitRequestFullscreen();
        return;
      }
    } catch {}

    // iPhone Safari: 要素単位 Fullscreen API が使えないので video 単独で全画面化。
    // スコアボードは映像に焼き込み済みなので iOS ネイティブ動画プレイヤーでも見える。
    if (allowVideoFallback) {
      const video = stage.querySelector("video") as IOSVideoElement | null;
      if (video?.webkitEnterFullscreen && video.readyState >= 2) {
        try {
          // iOS は webkitendfullscreen で video が一時停止状態になる。
          // 戻った瞬間と少し遅らせて複数回 play() を試行
          const onEnd = () => {
            video.removeEventListener("webkitendfullscreen", onEnd);
            const tryPlay = () => {
              video.play().catch(() => {});
            };
            tryPlay();
            setTimeout(tryPlay, 100);
            setTimeout(tryPlay, 500);
          };
          video.addEventListener("webkitendfullscreen", onEnd, { once: true });
          video.webkitEnterFullscreen();
          return;
        } catch {}
      }
    }

    // 最終フォールバック: フェイク全画面（CSS）
    setIsFakeFullscreen(true);
  }

  return {
    stageRef,
    isFullscreen: isNativeFullscreen || isFakeFullscreen,
    isFakeFullscreen,
    toggleFullscreen,
  };
}
