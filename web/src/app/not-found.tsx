import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ページが見つかりません",
  description: "お探しのページは存在しないか、URLが変更された可能性があります。",
};

export default function NotFound() {
  return (
    <div className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="text-[80px] font-bold leading-none bg-gradient-to-br from-[#e63946] to-[#f88080] bg-clip-text text-transparent">
        404
      </div>
      <h1 className="mt-4 text-xl font-bold text-white">
        ページが見つかりません
      </h1>
      <p className="mt-3 text-sm text-gray-400 leading-relaxed max-w-xs">
        お探しのページは存在しないか、URLが変更されたか、一時的にアクセスできない状態です。
      </p>
      <div className="mt-8 flex flex-col gap-3 w-full max-w-[240px]">
        <Link
          href="/"
          className="w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-3 rounded-md transition"
        >
          ホームに戻る
        </Link>
        <Link
          href="/lp"
          className="w-full border border-white/20 hover:bg-white/5 text-white text-sm font-semibold py-3 rounded-md transition"
        >
          LIVE SPOtCH について
        </Link>
      </div>
    </div>
  );
}
