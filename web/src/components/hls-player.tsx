"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 自前配信サーバー（MediaMTX）の HLS（.m3u8）を再生するプレイヤー。
 *
 * - Safari / iOS（＝Apple の WebKit）: <video> がネイティブで HLS を再生できるので src 直指定。
 * - Chrome / Firefox / Android: ネイティブ非対応なので hls.js を CDN から読み込んで再生。
 *
 * ★★ 2026-08-13 重大バグ修正: PC/Android の Chrome で「1コマも映らない」状態だった ★★
 *   経路の振り分けを `video.canPlayType("application/vnd.apple.mpegurl")` が truthy か
 *   どうかだけで決めていたが、**Chrome もこれに "maybe" を返す**（実測）。その結果
 *   Chrome はネイティブ経路に入り、実際には MEDIA_ERR_SRC_NOT_SUPPORTED で再生できず、
 *   エラー表示も出ないまま黒画面のままだった。＝共有リンクを開いた PC/Android の視聴者は
 *   永久に映像を見られない。詳細な判定根拠は canUseNativeHls() のコメントを参照。
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
const HLS_LOAD_TIMEOUT_MS = 10000; // CDN が無応答のまま固まるのを防ぐ上限
const RETRY_MS = 3000; // 配信中断中の再試行間隔
const STALL_TICK_MS = 2000; // ストール監視の間隔
const STALL_LIMIT = 3; // この回数連続で進まなければ再同期（約6秒）
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4; // HTMLMediaElement.error.code

/**
 * 「この環境は <video> にそのまま .m3u8 を渡して再生できるか」を判定する。
 *
 * ★ここを間違えると特定ブラウザだけ静かに黒画面になる。実測値を根拠に書いている。
 *
 * 【なぜ canPlayType の真偽だけではダメか】
 *   canPlayType("application/vnd.apple.mpegurl") の実測（2026-08-13 計測）:
 *     Chrome 151 (headless, macOS) → "maybe"   ← truthy なのに実際は再生できない
 *     WebKit (Safari と同一エンジン) → "maybe"
 *   つまり Chrome も truthy を返すため、真偽だけで分けると Chrome がネイティブ経路に
 *   入り込み、MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) で 1コマも再生されない。
 *   （なお canPlayType("video/bogus-nonsense") は両者とも "" を返すので、
 *     「何にでも maybe を返す」わけではない。HLS 固有の誤判定である。）
 *
 * 【なぜ === "probably" でもダメか】
 *   **WebKit も "maybe" しか返さない**（上記実測）。codecs パラメータの無い MIME に
 *   "probably" は返らないため、この判定を採用すると Safari / iOS が巻き添えで全滅する。
 *   ＝いま正常に見られている視聴者を壊す。よって不採用。
 *
 * 【採用した判定】
 *   ネイティブ HLS が本当に動くのは Apple の WebKit だけなので、WebKit 専用 API の
 *   有無で見分ける。実測（左: Chrome 151 / 右: WebKit）:
 *     WebKitPlaybackTargetAvailabilityEvent : false / true  （AirPlay API）
 *     window.ManagedMediaSource             : false / true  （Safari 17+ / iOS 17.1+）
 *     video.webkitSupportsFullscreen        : false / true  （iOS 由来の全画面 API）
 *   iOS 上の Chrome / Firefox も中身は WebKit なのでこれらが true になり、
 *   ネイティブ HLS が実際に動く＝正しく判定される。
 *
 *   さらに万一この判定を外しても黒画面にならないよう、ネイティブ経路には
 *   「一度もメタデータを読めずに code 4 で落ちたら hls.js に切り替える」保険を入れてある。
 */
function canUseNativeHls(video: HTMLVideoElement): boolean {
  // 大前提: そもそも HLS を名乗れない環境は除外
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  const w = window as unknown as {
    ManagedMediaSource?: unknown;
    WebKitPlaybackTargetAvailabilityEvent?: unknown;
  };
  return (
    typeof w.WebKitPlaybackTargetAvailabilityEvent !== "undefined" ||
    typeof w.ManagedMediaSource !== "undefined" ||
    "webkitSupportsFullscreen" in video
  );
}

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
    // ★必ず一度だけ・必ず解決する。解決しないと呼び出し側が永久に待って黒画面になる。
    let settled = false;
    const done = (v: HlsLike | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    // CDN がエラーも返さず無応答（広告ブロッカー/社内プロキシ等）でも先に進めるようにする
    const timer = setTimeout(() => done(w.Hls ?? null), HLS_LOAD_TIMEOUT_MS);

    const existing =
      document.querySelector<HTMLScriptElement>(`script[data-hls="1"]`);
    if (existing) {
      // ★以前の読み込みが既に失敗して終わっている場合、load/error はもう二度と発火しない。
      //   その状態で待ち続けると Promise が永久に未解決になる（＝2回目以降の視聴で無音の黒画面）。
      //   失敗済みの印を見て即座に諦める。
      if (existing.dataset.hlsFailed === "1") {
        done(null);
        return;
      }
      existing.addEventListener("load", () => done(w.Hls ?? null));
      existing.addEventListener("error", () => {
        existing.dataset.hlsFailed = "1";
        done(null);
      });
      return;
    }
    const s = document.createElement("script");
    s.src = HLS_CDN;
    s.async = true;
    s.dataset.hls = "1";
    s.onload = () => done(w.Hls ?? null);
    s.onerror = () => {
      s.dataset.hlsFailed = "1";
      done(null);
    };
    document.head.appendChild(s);
  });
}

export function HlsPlayer({
  src,
  onPlaybackMode,
}: {
  src: string;
  // どちらの経路で再生したかを親へ知らせる。
  // 視聴ページはこれを見てスコアオーバーレイの遅延量を切り替える
  // （hls.js 経路は liveSyncDurationCount のぶん映像が約4秒遅いため）。
  onPlaybackMode?: (mode: "native" | "hlsjs") => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // 親から渡された通知先を ref に逃がす。再生の effect の依存は [src] のままにしたいので、
  // コールバックの同一性が変わっても再生をやり直させない。
  const onPlaybackModeRef = useRef(onPlaybackMode);
  useEffect(() => {
    onPlaybackModeRef.current = onPlaybackMode;
  }, [onPlaybackMode]);

  // ★ 2026-08-04: ブラウザの自動再生ルールを満たすため既定でミュートにしているが、
  //   **音を出す案内を一切出していなかった**。祖父母がリンクを開くと映像は出るのに無音で、
  //   孫の名前を呼ぶ声もホイッスルも聞こえない。しかも LiveKit 経路（Android配信）は
  //   ミュートしていないため、**同じサービスなのに配信者の端末によって音が出たり出なかったり
  //   する**。解除手段が小さなスピーカーアイコンだけでは高齢の視聴者には届かない。
  //   → ミュート中は大きな「🔊 タップして音を出す」を重ね、押したら解除する。
  const [muted, setMuted] = useState(true);

  // ネイティブでも hls.js でも再生手段が無かった時だけ立てる。
  // ★黒画面のまま何も言わないのが今回のバグの本質だったので、必ず視聴者に理由を見せる。
  const [unplayable, setUnplayable] = useState(false);

  // src が変わったら（別の配信に切り替わったら）エラー表示を捨てる。
  // effect 内で同期 setState すると再レンダーが連鎖するため、React 公式の
  // 「レンダー中に前回値と比べて調整する」パターンを使う。
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setUnplayable(false);
  }

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

    // ネイティブ経路で登録したリスナーを剥がすための後始末（hls.js へ切り替える時に使う）
    let detachNative: (() => void) | null = null;
    let switchedToHlsJs = false;

    // === Chrome / Firefox / Android = hls.js（CDN） ===
    // ネイティブ経路から切り替わって来ることがあるので先に定義しておく。
    //
    // bustCache: ネイティブ再生に失敗してから切り替わって来た時だけ true。
    //   ネイティブの <video> は no-cors でリクエストするため、その応答が HTTP キャッシュに
    //   残る。直後に hls.js が同じ URL を CORS(XHR) で取りに行くとキャッシュを再利用して
    //   CORS エラー（status 0 / manifestLoadError）になり、切り替えたのに再生できない。
    //   実測で再現・確認済みのため、切替時のみ全リクエストに使い捨てトークンを付けて回避する。
    //   （通常の視聴者はこの経路を通らないので CDN のキャッシュ効率には影響しない）
    const startHlsJs = (bustCache = false) => {
      // ★スコア同期用の経路通知。ネイティブから切り替わって来た場合もここを通る。
      //   なお下の「hls.js が使えない環境」の分岐では video.src 直指定（＝実質ネイティブ）に
      //   落ちるが、そこでは訂正しない。遅い側（hls.js 相当）に倒しておく方が安全なため
      //   （早すぎる＝得点のネタバレ／遅すぎる＝ほぼ気づかれない、の非対称リスク）。
      onPlaybackModeRef.current?.("hlsjs");
      const bustToken = bustCache ? String(Date.now()) : null;
      const bust = (u: string) =>
        bustToken ? `${u}${u.includes("?") ? "&" : "?"}_r=${bustToken}` : u;
      loadHls()
        .then((Hls) => {
          if (cancelled) return;
          if (!Hls || !Hls.isSupported()) {
            // hls.js が使えない環境（CDN 到達不可 / MSE 非対応の古い端末）。
            // ネイティブに賭けるしかないので src 直指定でフォールバックする。
            // ただしネイティブから来た場合は既にそれが失敗しているので、黒画面のままにせず案内を出す。
            if (switchedToHlsJs) {
              setUnplayable(true);
              return;
            }
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
            //
            // ★2026-08-13: 4 → 6 に増量。
            //   配信側の到達遅延の実測が 2.5〜3.7 秒で揺れており、4セグメント(≈8秒)の
            //   手持ちでは揺れの山でバッファが枯れてカクついていた。6セグメント(≈12秒)に
            //   広げて揺れを吸収する。代償として視聴が約4秒遅くなるがオーナー了承済み
            //   （低遅延はマーケ訴求から外している方針）。
            //   注意: これはサーバー(MediaMTX)のプレイリストが6セグメント以上を保持している
            //   前提。hlsSegmentCount を6以下に絞ると視聴位置がプレイリストの最古端に貼り付き、
            //   セグメントが先に消えて逆にカクつく。MediaMTX 既定は7。
            liveSyncDurationCount: 6, // ライブ端から約6セグメント(≈12秒)後方を再生位置に
            maxBufferLength: 30,
            backBufferLength: 30,
            // 切替時のみ: 全リクエスト（プレイリスト・サブプレイリスト・セグメント）を
            // キャッシュ迂回させる。hls.js は xhrSetup 内で open() すると自前の open を省く。
            ...(bustToken
              ? {
                  xhrSetup: (xhr: XMLHttpRequest, url: string) => {
                    xhr.open("GET", bust(url), true);
                  },
                }
              : {}),
          });
          hls = instance;
          instance.loadSource(bust(src));
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
              hls.loadSource(bust(src));
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
          if (cancelled) return;
          if (switchedToHlsJs) {
            setUnplayable(true);
            return;
          }
          video.src = src;
        });
    };

    // === Safari / iOS（Apple WebKit）= ネイティブ HLS ===
    const startNative = () => {
      // ★スコア同期用の経路通知。ネイティブ再生は hls.js のバッファ設定の影響を受けないため、
      //   視聴ページ側は従来どおりの遅延量を使う。
      onPlaybackModeRef.current?.("native");
      // 一度でもメタデータを読めたか。＝「この環境で HLS が本当に再生できたか」の証拠。
      let sawMetadata = false;

      const reloadNative = () => {
        if (cancelled) return;
        // src を貼り直して再読込（配信が戻る/再接続時に最新へ再同期）
        video.src = src;
        video.load();
        video.play().catch(() => {});
      };
      const onLoadedMetadata = () => {
        sawMetadata = true;
      };
      const onError = () => {
        if (cancelled) return;
        // ★保険（判定ミスの最終防衛線）:
        //   一度もメタデータを読めないまま MEDIA_ERR_SRC_NOT_SUPPORTED で落ちた場合、
        //   この環境はネイティブ HLS を本当に再生できない。黙って黒画面にせず hls.js へ移す。
        //   逆に「一度は再生できていた」なら配信側の一時中断なので、ネイティブのまま再試行する
        //   （＝ Safari の正常系を壊さない）。
        if (
          !sawMetadata &&
          !switchedToHlsJs &&
          video.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED
        ) {
          // ★ここで即座に切り替えてはいけない。
          //   Safari(WebKit) は「本当に非対応」のときだけでなく、
          //     ①配信がまだ始まっていない（m3u8 が 404）
          //     ②サーバーが一瞬エラーを返した
          //     ③電波が悪くて取得できない
          //   のいずれでも **同じ code 4** を返す（実測: 3件中3件）。
          //   見分けずに切り替えると、体育館で電波が一瞬切れただけで
          //   iPhone の視聴者が片道で別経路に移され、iOS 17.1 未満の端末では
          //   そのまま永久エラーになる。現状は3秒ごとに自動復帰するので明確な後退。
          //   → **プレイリストが実際に取れるか**を1回確かめ、
          //     「取れているのに再生できない」＝本当に非対応、のときだけ切り替える。
          void (async () => {
            let genuinelyUnsupported = false;
            try {
              const res = await fetch(src, { cache: "no-store" });
              if (res.ok) {
                const text = await res.text();
                // 中身が本当に HLS のプレイリストなら、取得は成功している＝再生側の非対応
                genuinelyUnsupported = text.trimStart().startsWith("#EXTM3U");
              }
            } catch {
              // 取得自体が失敗＝配信前/一時的な不通。ネイティブのまま再試行する。
              genuinelyUnsupported = false;
            }
            if (cancelled || switchedToHlsJs) return;
            if (!genuinelyUnsupported) {
              // 一時的な不調とみなし、従来どおりネイティブで再試行する。
              if (retryTimer) return;
              retryTimer = setTimeout(() => {
                retryTimer = null;
                reloadNative();
              }, RETRY_MS);
              return;
            }
            switchedToHlsJs = true;
            detachNative?.();
            clearTimers();
            startHlsJs(true); // ネイティブが汚したキャッシュを迂回する
          })();
          return;
        }
        if (retryTimer) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          reloadNative();
        }, RETRY_MS);
      };
      const onStalled = () => {
        video.play().catch(() => {});
      };
      video.addEventListener("loadedmetadata", onLoadedMetadata);
      video.addEventListener("error", onError);
      video.addEventListener("stalled", onStalled);
      detachNative = () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("error", onError);
        video.removeEventListener("stalled", onStalled);
        // hls.js に渡す前に、再生できなかった src を外して要素をまっさらにする
        video.removeAttribute("src");
        video.load();
      };
      video.src = src;
      video.play().catch(() => {});
      startWatchdog(reloadNative);
    };

    if (canUseNativeHls(video)) {
      startNative();
    } else {
      startHlsJs();
    }

    return () => {
      cancelled = true;
      clearTimers();
      detachNative?.();
      if (hls) hls.destroy();
    };
  }, [src]);

  const unmute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    // 一部ブラウザは muted 解除だけでは再生が止まるため念のため再開させる
    v.play().catch(() => {});
    setMuted(false);
  };

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        playsInline
        controls
        autoPlay
        muted
        onVolumeChange={(e) => setMuted((e.target as HTMLVideoElement).muted)}
      />
      {muted && !unplayable && (
        <button
          onClick={unmute}
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit max-w-[85%] flex items-center gap-2 rounded-full bg-[#e63946] px-6 py-4 text-white text-base sm:text-lg font-bold shadow-2xl active:scale-95 transition"
          aria-label="音を出す"
        >
          <span className="text-2xl">🔊</span>
          タップして音を出す
        </button>
      )}
      {unplayable && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center text-white">
          <p className="text-base sm:text-lg font-bold">
            このブラウザでは映像を再生できませんでした
          </p>
          <p className="text-sm text-white/80">
            通信環境が不安定か、お使いのブラウザが対応していない可能性があります。
            <br />
            Safari または Chrome の最新版でお試しください。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-1 rounded-full bg-[#e63946] px-6 py-3 text-white text-base font-bold shadow-lg active:scale-95 transition"
          >
            再読み込み
          </button>
        </div>
      )}
    </div>
  );
}
