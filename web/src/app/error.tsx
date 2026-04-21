"use client";

import { useEffect } from "react";
import Link from "next/link";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
};

export default function Error({ error, reset, unstable_retry }: ErrorProps) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-[#e63946]/15 flex items-center justify-center">
        <svg
          className="w-7 h-7 text-[#e63946]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-bold text-white">
        問題が発生しました
      </h1>
      <p className="mt-3 text-sm text-gray-400 leading-relaxed max-w-xs">
        一時的なエラーの可能性があります。少し時間を置いて再度お試しください。
      </p>
      {error.digest && (
        <p className="mt-3 text-[10px] text-gray-600">
          エラーID: <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <div className="mt-8 flex flex-col gap-3 w-full max-w-[240px]">
        <button
          onClick={() => retry()}
          className="w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-3 rounded-md transition"
        >
          もう一度試す
        </button>
        <Link
          href="/"
          className="w-full border border-white/20 hover:bg-white/5 text-white text-sm font-semibold py-3 rounded-md transition"
        >
          ホームに戻る
        </Link>
      </div>
    </div>
  );
}
