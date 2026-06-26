"use client";

import { useEffect, useRef } from "react";

/**
 * 自前配信サーバー（MediaMTX）の HLS（.m3u8）を再生するプレイヤー。
 *
 * - Safari / iOS: <video> がネイティブで HLS を再生できるので src 直指定。
 * - Chrome / Firefox / Android: ネイティブ非対応なので hls.js を CDN から読み込んで再生。
 *
 * ★中断耐性（セッション継続性）: 配信者が電話/回線切替/バックグラウンドで一瞬中断すると
 * MediaMTX の .m3u8 が数秒〜数十秒 404/stale になる。その間プレイヤーを破棄せず、
 * バックオフで startLoad / src 再ロードを繰り返し、配信が戻ったら自動で再生継続する。
 * ＝視聴者には「配信終了」と見せず、再共有や再視聴の手間を出さない。
 *
 * スコアは視聴ページ側の CSS オーバーレイ(ViewerScoreboardOverlay)で重ねるため、
 * ここは video のみを描画する。
 */

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
const RETRY_MS = 3000; // 配信中断中の再試行間隔

type HlsInstance = {
  loadSource: (src: string) => void;
  attachMedia: (video: HTMLMediaElement) => void;
  startLoad: (startPosition?: number) => void;
  recoverMediaError: () => void;
  destroy: () => void;
  on: (
    event: string,
    cb: (
      event: string,
      data: { type: string; details: string; fatal: boolean },
    ) => void,
  ) => void;
};

type HlsLike = {
  isSupported: () => boolean;
  Events: { ERROR: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
  new (config?: unknown): HlsInstance;
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
    let hls: HlsInstance | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    // === Safari / iOS = ネイティブ HLS ===
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      const reloadNative = () => {
        if (cancelled) return;
        // src を貼り直して再読込（配信が戻れば再生継続）
        video.src = src;
        video.load();
        video.play().catch(() => {});
      };
      const onError = () => {
        if (cancelled || retryTimer) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          reloadNative();
        }, RETRY_MS);
      };
      const onStalled = () => {
        video.play().catch(() => {});
      };
      video.addEventListener("error", onError);
      video.addEventListener("stalled", onStalled);
      video.src = src;
      video.play().catch(() => {});
      return () => {
        cancelled = true;
        clearRetry();
        video.removeEventListener("error", onError);
        video.removeEventListener("stalled", onStalled);
      };
    }

    // === それ以外 = hls.js（CDN） ===
    loadHls()
      .then((Hls) => {
        if (cancelled) return;
        if (!Hls || !Hls.isSupported()) {
          // 最終手段（古い環境）
          video.src = src;
          video.play().catch(() => {});
          return;
        }
        const instance = new Hls({
          // ライブの一時断に強くする（配信が戻るまで諦めない）
          liveDurationInfinity: true,
          fragLoadingMaxRetry: 8,
          levelLoadingMaxRetry: 8,
          manifestLoadingMaxRetry: 8,
        });
        hls = instance;
        instance.loadSource(src);
        instance.attachMedia(video);
        video.play().catch(() => {});

        const scheduleReload = () => {
          if (cancelled || retryTimer) return;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (cancelled || !hls) return;
            try {
              // 配信が戻っていれば startLoad で再開。まだなら次の ERROR で再スケジュール。
              hls.startLoad();
              video.play().catch(() => {});
            } catch {
              /* noop */
            }
          }, RETRY_MS);
        };

        instance.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return; // 非fatalはhls.jsが自動再試行するので放置
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              instance.recoverMediaError();
            } catch {
              scheduleReload();
            }
          } else {
            // NETWORK_ERROR 等（配信中断で manifest/level が 404 継続）→ 破棄せず再試行を続ける
            scheduleReload();
          }
        });
      })
      .catch(() => {
        if (!cancelled) video.src = src;
      });

    return () => {
      cancelled = true;
      clearRetry();
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
