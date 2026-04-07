"use client";

import { useState, useEffect, use } from "react";

export default function WatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      {/* 共有コード表示 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-gray-600">共有コード:</span>
        <span className="text-xs font-bold tracking-widest">{code.toUpperCase()}</span>
      </div>

      {/* 映像エリア */}
      <div className="aspect-[16/9] bg-[#111] rounded-lg border border-white/5 flex items-center justify-center relative overflow-hidden">
        {/* 再生ボタン */}
        <button
          onClick={() => setShowModal(true)}
          className="flex flex-col items-center gap-3 group"
        >
          <div className="w-16 h-16 rounded-full bg-[#e63946] flex items-center justify-center group-hover:bg-[#d62836] transition shadow-lg shadow-[#e63946]/20">
            <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="text-xs text-gray-400">タップして視聴</span>
        </button>

        {/* スコアボード・オーバーレイ */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-3 px-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <p className="text-[10px] text-gray-400">HOME</p>
              <p className="text-sm font-bold">チーム A</p>
            </div>
            <div className="text-center mx-4">
              <p className="text-2xl font-black tabular-nums">0 - 0</p>
              <p className="text-[9px] text-gray-400">前半 00:00</p>
            </div>
            <div className="text-center flex-1">
              <p className="text-[10px] text-gray-400">AWAY</p>
              <p className="text-sm font-bold">チーム B</p>
            </div>
          </div>
        </div>

        {/* LIVEバッジ */}
        <div className="absolute top-3 left-3 flex items-center gap-1 bg-[#e63946] px-2 py-0.5 rounded text-[9px] font-bold">
          <span className="w-1 h-1 bg-white rounded-full" />
          LIVE
        </div>
      </div>

      {/* 試合情報 */}
      <div className="mt-4 rounded-md bg-[#111] border border-white/5 px-4 py-3">
        <p className="text-[9px] text-gray-600">試合情報</p>
        <p className="text-sm font-medium mt-1">チーム A vs チーム B</p>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Supabase接続後に実際の試合情報が表示されます
        </p>
      </div>

      <p className="mt-8 text-center text-[10px] text-gray-700 pb-16">
        この配信は共有コードを持っている方のみ視聴できます
      </p>

      {/* アプリ登録モーダル */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-5">
          <div className="w-full max-w-sm rounded-xl bg-[#111] border border-white/10 p-6">
            <h3 className="text-base font-bold text-center">
              視聴するにはアプリ登録が必要です
            </h3>
            <p className="mt-3 text-xs text-gray-400 text-center leading-relaxed">
              無料のアプリ登録で、すべての配信を視聴できます。
              <br />
              視聴は完全無料です。
            </p>

            <div className="mt-6 space-y-2">
              <a
                href="/mypage"
                className="block w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-3 rounded-md transition text-center"
              >
                無料で登録して視聴する
              </a>
              <p className="text-center text-[10px] text-gray-600">
                App Store / Google Play 準備中
              </p>
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="mt-4 w-full text-xs text-gray-600 hover:text-gray-400 transition py-2"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
