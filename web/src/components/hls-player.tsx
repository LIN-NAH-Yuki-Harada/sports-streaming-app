"use client";

import { useEffect, useRef } from "react";

/**
 * 自前配信サーバー（MediaMTX）の HLS（.m3u8）を再生するプレイヤー。
 *
 * - Safari / iOS: <video> がネイティブで HLS を再生できるので src 直指定。
 * - Chrome / Firefox / Android: ネイティブ非対応なので hls.js を CDN から読み込んで再生。
 *
 * ★中断耐性（セッション継続性）:
 * 1) 配信者が電話/回線切替/バックグラウンドで一瞬中断すると .m3u8 が数秒〜数十秒 404/stale に
 *    なる。その間プレイヤーを破棄せず、バックオフで startLoad / src 再ロードを繰り返す。
 * 2) 配信者が 5G↔WiFi 切替などで「再接続」すると、新しい publisher に切り替わって HLS の
 *    セグメント列が不連続になり、プレイヤーが古い位置で固まる（ストール）。これは fatal error
 *    では無いので①の復帰が効かない。そのため「映像が進んでいない」を見張って、止まったら
 *    最新位置へ再同期（再ロード）する watchdog を入れる。＝映像だけ止まりスコアだけ動く現象の対策。
 *
 * スコアは視聴ページ側の CSS オーバーレイ(ViewerScoreboardOverlay)で重ねるため video のみ描画。
 */

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
const RETRY_MS = 3000; // 配信中断中の再試行間隔
const STALL_TICK_MS = 2000; // ストール監視の間隔
const STALL_LIMIT = 3; // この回数連続で進まなければ再同期（約6秒）

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
    let stallTimer: ReturnType<typeof setInterval> | null = null;

    const clearTimers = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    };

    // 「映像が進んでいない」を監視し、止まったら recover() で最新へ再同期する。
    const startWatchdog = (recover: () => void) => {
      let lastT = -1;
      let stalls = 0;
      stallTimer = setInterval(() => {
        if (cancelled) return;
        if (video.paused || video.ended || video.seeking) {
          stalls = 0;
          lastT = video.currentTime;
          return;
        }
        if (video.currentTime <= lastT + 0.01) {
          stalls += 1;
          if (stalls >= STALL_LIMIT) {
            stalls = 0;
            recover();
          }
        } else {
          stalls = 0;
        }
        lastT = video.currentTime;
      }, STALL_TICK_MS);
    };

    // === Safari / iOS = ネイティブ HLS ===
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      const reloadNative = () => {
        if (cancelled) return;
        // src を貼り直して再読込（配信が戻る/再接続時に最新へ再同期）
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
      startWatchdog(reloadNative);
      return () => {
        cancelled = true;
        clearTimers();
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
          // 配信側がセルラー(4G/5G)の場合、上り帯域不足で送信がバースト化し
          // 一時的にセグメント供給が数秒途切れる。視聴位置をライブ端から少し後方に取り、
          // 前方バッファを厚めに保つことで、その数秒を吸収して映像が止まりにくくする
          // （トレードオフで遅延は数秒増える。スポーツ視聴では許容範囲）。
          liveSyncDurationCount: 4, // ライブ端から約4セグメント(≈8秒)後方を再生位置に
          maxBufferLength: 30,
          backBufferLength: 30,
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

        // ストール時の再同期: プレイリストを読み直して最新セグメント（live edge）へ。
        const resyncToLive = () => {
          if (cancelled || !hls) return;
          try {
            hls.loadSource(src);
            hls.startLoad();
            video.play().catch(() => {});
          } catch {
            /* noop */
          }
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

        startWatchdog(resyncToLive);
      })
      .catch(() => {
        if (!cancelled) video.src = src;
      });

    return () => {
      cancelled = true;
      clearTimers();
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
