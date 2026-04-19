"use client";

import { useState } from "react";

type Platform = "ios" | "android" | "pc";

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "ios", label: "iPhone / iPad" },
  { key: "android", label: "Android" },
  { key: "pc", label: "PC" },
];

const STEPS: Record<Platform, { title: string; body: string[] }> = {
  ios: {
    title: "iPhone / iPad（Safari）",
    body: [
      "1. アドレスバー左の「ぁあ」ボタンをタップ",
      "2. 「Webサイトの設定」を選択",
      "3. 「カメラ」を「許可」に変更",
      "4. 下の「再読み込み」ボタンを押す",
    ],
  },
  android: {
    title: "Android（Chrome）",
    body: [
      "1. アドレスバー左の🔒（鍵）アイコンをタップ",
      "2. 「権限」→「カメラ」→「許可」を選択",
      "3. 「マイク」も同様に「許可」を選択",
      "4. 下の「再読み込み」ボタンを押す",
    ],
  },
  pc: {
    title: "PC（Chrome / Safari / Edge）",
    body: [
      "1. アドレスバー左のアイコン（🔒 または ⓘ）をクリック",
      "2. 「カメラ」と「マイク」を「許可」に設定",
      "3. 下の「再読み込み」ボタンを押す",
    ],
  },
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "pc";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "pc";
}

export function CameraPermissionGuide({
  open,
  onClose,
}: {
  open: boolean;
  onClose?: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());

  if (!open) return null;

  const current = STEPS[platform];

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-guide-title"
    >
      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 shrink-0 rounded-full bg-[#e63946]/15 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg className="w-5 h-5 text-[#e63946]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="camera-guide-title" className="text-base font-bold text-white">
              カメラの使用を許可してください
            </h2>
            <p className="mt-1 text-xs text-gray-400 leading-relaxed">
              ライブ配信にはカメラとマイクへのアクセスが必要です。以下の手順で許可を変更してください。
            </p>
          </div>
        </div>

        {/* プラットフォーム切替タブ */}
        <div className="mt-5 flex gap-1 bg-black/40 rounded-lg p-1" role="tablist" aria-label="プラットフォームを選択">
          {PLATFORMS.map((p) => {
            const active = platform === p.key;
            return (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPlatform(p.key)}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* 手順表示 */}
        <div className="mt-4 rounded-lg bg-black/30 border border-white/5 p-4">
          <p className="text-xs font-semibold text-gray-300 mb-2">{current.title}</p>
          <ol className="space-y-1.5 text-xs text-gray-400 leading-relaxed">
            {current.body.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>

        {/* アクション */}
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-md bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-2.5 transition"
          >
            許可の設定を完了したら、再読み込み
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md border border-white/10 text-gray-400 text-xs py-2 hover:bg-white/5 transition"
            >
              閉じる
            </button>
          )}
        </div>

        <p className="mt-4 text-[10px] text-gray-600 leading-relaxed text-center">
          それでも解決しない場合は、
          <a href="/contact" className="text-[#e63946] hover:underline">
            お問い合わせ
          </a>
          からご連絡ください
        </p>
      </div>
    </div>
  );
}

// カメラ許可拒否エラーを判定
export function isCameraPermissionError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") return true;
    if (error.name === "PermissionDeniedError") return true;
    const msg = error.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("denied") || msg.includes("not allowed")) {
      return true;
    }
  }
  return false;
}
