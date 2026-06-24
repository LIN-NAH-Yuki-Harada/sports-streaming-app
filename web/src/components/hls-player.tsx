"use client";

import { useEffect, useRef } from "react";

/**
 * 自前配信サーバー（MediaMTX）の HLS（.m3u8）を再生するプレイヤー。
 *
 * - Safari / iOS: <video> がネイティブで HLS を再生できるので src 直指定。
 * - Chrome / Firefox / Android: ネイティブ非対応なので hls.js を CDN から読み込んで再生。
 *
 * hls.js は npm 依存にせず CDN（jsDelivr）から動的ロードする（CSP 未導入なので可・
 * worktree の node_modules を汚さない）。将来 npm バンドルに切替えてもよい。
 *
 * スコアは配信端末で映像に焼き込み済み（self-host RTMP 経路）なので、ここでは
 * CSS オーバーレイは重ねない（video のみ）。
 */

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";

type HlsLike = {
  isSupported: () => boolean;
  new (config?: unknown): {
    loadSource: (src: string) => void;
    attachMedia: (video: HTMLMediaElement) => void;
    destroy: () => void;
  };
};

function loadHls(): Promise<HlsLike | null> {
  const w = window as unknown as { Hls?: HlsLike };
  if (w.Hls) return Promise.resolve(w.Hls);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-hls="1"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(w.Hls ?? null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = HLS_CDN;
    s.async = true;
    s.dataset.hls = "1";
    s.onload = () => resolve(w.Hls ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

export function HlsPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    // Safari / iOS = ネイティブ HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.play().catch(() => {});
      return;
    }

    // それ以外 = hls.js（CDN）
    loadHls()
      .then((Hls) => {
        if (cancelled) return;
        if (Hls && Hls.isSupported()) {
          const instance = new Hls();
          instance.loadSource(src);
          instance.attachMedia(video);
          hls = instance;
          video.play().catch(() => {});
        } else {
          // 最終手段（古い環境）
          video.src = src;
          video.play().catch(() => {});
        }
      })
      .catch(() => {
        video.src = src;
      });

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      className="w-full h-full object-contain bg-black"
      playsInline
      controls
      autoPlay
      muted
    />
  );
}
