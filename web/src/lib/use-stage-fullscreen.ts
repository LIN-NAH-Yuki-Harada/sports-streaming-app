"use client";

import { useEffect, useRef, useState } from "react";

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/**
 * ステージ要素を全画面化するフック。
 *
 * 要素単位の Fullscreen API が使える環境（PC Chrome, Android Chrome, iPad Safari 16.4+）
 * ではネイティブ全画面、使えない環境（iPhone Safari 等）ではフェイク全画面
 * (`fixed inset-0 z-50`) にフォールバックする。どちらの経路でも、ステージ内に置いた
 * オーバーレイ（スコアボード等）が表示され続ける。
 */
export function useStageFullscreen<T extends HTMLElement = HTMLDivElement>() {
  const stageRef = useRef<T | null>(null);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);

  // ネイティブ全画面状態を追従（ESC・iOS のスワイプ離脱に対応）
  useEffect(() => {
    const doc = document as FullscreenDocument;
    const handler = () => {
      const active = doc.fullscreenElement || doc.webkitFullscreenElement;
      setIsNativeFullscreen(Boolean(active));
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

    // フォールバック: フェイク全画面
    setIsFakeFullscreen(true);
  }

  return {
    stageRef,
    isFullscreen: isNativeFullscreen || isFakeFullscreen,
    isFakeFullscreen,
    toggleFullscreen,
  };
}
