"use client";

import { useState, useEffect } from "react";

type InstallGuideKind =
  | "ios-safari"
  | "android-chrome"
  | "ios-needs-safari"
  | "android-needs-chrome"
  | "desktop";

export function ShareCodeInput() {
  const [code, setCode] = useState("");

  return (
    <section className="px-5 md:px-8 lg:px-10 pt-6">
      <h2 className="text-sm md:text-base font-semibold text-gray-300 mb-3">
        共有コードで試合を見る
      </h2>
      <div className="flex gap-2 md:max-w-xl">
        <input
          type="text"
          placeholder="共有コードを入力（例: ABC123）"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="flex-1 bg-[#111] border border-white/10 rounded-md px-3 py-3 text-base text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition tracking-widest"
          maxLength={8}
        />
        <a
          href={code.trim() ? `/watch/${code.trim()}` : "#"}
          className={`shrink-0 px-5 py-3 rounded-md text-sm font-semibold transition ${
            code.trim()
              ? "bg-[#e63946] text-white hover:bg-[#d62836]"
              : "bg-white/5 text-gray-600 cursor-not-allowed"
          }`}
        >
          視聴
        </a>
      </div>
      <p className="mt-2 text-xs text-gray-600">
        配信者から共有されたコードまたはURLで視聴できます
      </p>
    </section>
  );
}

export function InstallGuide() {
  const [isStandalone, setIsStandalone] = useState(false);
  const [guideKind, setGuideKind] = useState<InstallGuideKind>("desktop");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    const isInApp = /Line\/|Instagram|FBAN|FBAV|TwitterFor/.test(ua);
    const isIOSSafari =
      isIOS &&
      /Safari/.test(ua) &&
      !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) &&
      !isInApp;
    const isAndroidChrome =
      isAndroid &&
      /Chrome/.test(ua) &&
      !/SamsungBrowser|UCBrowser|EdgA|OPR/.test(ua) &&
      !isInApp;
    if (isIOSSafari) setGuideKind("ios-safari");
    else if (isAndroidChrome) setGuideKind("android-chrome");
    else if (isIOS) setGuideKind("ios-needs-safari");
    else if (isAndroid) setGuideKind("android-needs-chrome");
    else setGuideKind("desktop");
  }, []);

  if (!mounted || isStandalone || guideKind === "desktop") return null;

  return (
    <section className="px-5 md:px-8 lg:px-10 pt-6">
      <div className="rounded-xl bg-gradient-to-br from-[#e63946]/10 via-[#111] to-[#111] border border-[#e63946]/20 p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#e63946]/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-11 h-11 rounded-xl bg-[#e63946] flex items-center justify-center shadow-lg shadow-[#e63946]/20">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v12m-4-8l4-4 4 4M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3"
                />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold">もっと快適に配信・視聴</p>
              <p className="text-xs text-gray-500">
                ホーム画面に追加してアプリ化
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-400 leading-relaxed mt-3">
            ホーム画面に追加すると、URLバーが消えて
            <strong className="text-gray-300">全画面で配信・視聴</strong>
            ができます。アプリのようにワンタップで起動。
          </p>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-lg bg-black/30 px-2 py-2.5 text-center">
              <svg
                className="w-5 h-5 text-[#e63946] mx-auto mb-1"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
              <p className="text-[11px] text-gray-400">全画面配信</p>
            </div>
            <div className="rounded-lg bg-black/30 px-2 py-2.5 text-center">
              <svg
                className="w-5 h-5 text-[#e63946] mx-auto mb-1"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <p className="text-[11px] text-gray-400">ワンタップ起動</p>
            </div>
            <div className="rounded-lg bg-black/30 px-2 py-2.5 text-center">
              <svg
                className="w-5 h-5 text-[#e63946] mx-auto mb-1"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
              <p className="text-[11px] text-gray-400">アプリ感覚</p>
            </div>
          </div>

          {(guideKind === "ios-needs-safari" ||
            guideKind === "android-needs-chrome") && (
            <InAppBrowserWarning kind={guideKind} />
          )}
          {guideKind === "ios-safari" && <IOSInstallSteps />}
          {guideKind === "android-chrome" && <AndroidInstallSteps />}
        </div>
      </div>
    </section>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#e63946] text-white text-[11px] font-bold">
      {n}
    </span>
  );
}

function SafariShareGlyph() {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-white/10 align-middle mx-1">
      <svg
        className="w-3.5 h-3.5 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 16V4m0 0l-4 4m4-4l4 4M6 14v4a2 2 0 002 2h8a2 2 0 002-2v-4"
        />
      </svg>
    </span>
  );
}

function ChromeMenuGlyph() {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-white/10 align-middle mx-1">
      <svg
        className="w-3.5 h-3.5 text-white"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="5" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
      </svg>
    </span>
  );
}

function IOSInstallSteps() {
  return (
    <div className="mt-5 pt-4 border-t border-white/5">
      <p className="text-xs text-[#e63946] font-bold mb-3">
        iPhone での追加手順
      </p>
      <ol className="space-y-3">
        <li className="flex gap-3">
          <StepNumber n={1} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              画面下の共有ボタン
              <SafariShareGlyph />
              をタップ
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Safari 画面下部の中央にあります
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={2} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              メニューを下にスクロールして
              <strong className="text-white">「ホーム画面に追加」</strong>
              を選択
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={3} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              右上の<strong className="text-white">「追加」</strong>をタップ
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              ホーム画面に LIVE SPOtCH のアイコンが追加されます
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}

function AndroidInstallSteps() {
  return (
    <div className="mt-5 pt-4 border-t border-white/5">
      <p className="text-xs text-[#e63946] font-bold mb-3">
        Android での追加手順
      </p>
      <ol className="space-y-3">
        <li className="flex gap-3">
          <StepNumber n={1} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              画面右上のメニュー
              <ChromeMenuGlyph />
              をタップ
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              アドレスバーの右端にある縦3点のアイコンです
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={2} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              <strong className="text-white">「ホーム画面に追加」</strong>
              または
              <strong className="text-white">「アプリをインストール」</strong>
              を選択
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={3} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              表示されたダイアログで
              <strong className="text-white">「追加」</strong>
              または
              <strong className="text-white">「インストール」</strong>
              をタップ
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}

function InAppBrowserWarning({
  kind,
}: {
  kind: "ios-needs-safari" | "android-needs-chrome";
}) {
  const isIOS = kind === "ios-needs-safari";
  return (
    <div className="mt-5 pt-4 border-t border-white/5">
      <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3.5 mb-4">
        <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L1 21h22L12 2zm0 6l7.5 13h-15L12 8zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z" />
          </svg>
          まず {isIOS ? "Safari" : "Chrome"} で開き直してください
        </p>
        <p className="text-[11px] text-amber-100/70 mt-1.5 leading-relaxed">
          このアプリ内ブラウザでは「ホーム画面に追加」機能が使えません。
          {isIOS ? "Safari" : "Chrome"} で開き直すと追加できます。
        </p>
      </div>

      <p className="text-xs text-[#e63946] font-bold mb-3">
        {isIOS ? "Safari" : "Chrome"} で開く手順
      </p>
      <ol className="space-y-3">
        <li className="flex gap-3">
          <StepNumber n={1} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              画面{isIOS ? "右下" : "右上"}の
              <strong className="text-white">「…」</strong>
              または
              <strong className="text-white">「⋮」</strong>
              メニューをタップ
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={2} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              {isIOS ? (
                <>
                  <strong className="text-white">「Safari で開く」</strong>
                  （または「デフォルトのブラウザで開く」）を選択
                </>
              ) : (
                <>
                  <strong className="text-white">「別のブラウザで開く」</strong>
                  （または「他のアプリで開く」）→
                  <strong className="text-white"> Chrome </strong>
                  を選択
                </>
              )}
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={3} />
          <div>
            <p className="text-sm text-gray-200 leading-relaxed">
              {isIOS ? "Safari" : "Chrome"} で開いたら、
              このページがもう一度表示され
              <strong className="text-white">
                「{isIOS ? "iPhone" : "Android"} での追加手順」
              </strong>
              が出てきます
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}
