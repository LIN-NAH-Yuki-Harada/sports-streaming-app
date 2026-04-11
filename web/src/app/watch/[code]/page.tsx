"use client";

import { useState, useEffect, useRef, use } from "react";
import { getBroadcastByCode, type Broadcast } from "@/lib/database";
import { createClient } from "@/lib/supabase";

export default function WatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [loadingBroadcast, setLoadingBroadcast] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // 初回: DBから配信データを取得
  useEffect(() => {
    async function fetchBroadcast() {
      const data = await getBroadcastByCode(code);
      if (data) {
        setBroadcast(data);
      } else {
        setNotFound(true);
      }
      setLoadingBroadcast(false);
    }
    fetchBroadcast();
  }, [code]);

  // リアルタイム更新: Supabase Realtime でスコア変更を受信
  useEffect(() => {
    if (!broadcast) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`broadcast-${broadcast.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "broadcasts",
          filter: `id=eq.${broadcast.id}`,
        },
        (payload) => {
          setBroadcast((prev) => (prev ? { ...prev, ...payload.new } : prev));
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("[realtime] 購読成功");
        } else {
          console.error("[realtime] 購読状態:", status, err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [broadcast?.id]);

  // Realtimeが動かない場合のフォールバック: 5秒ごとにDBをポーリング
  const shareCodeRef = useRef(broadcast?.share_code);
  shareCodeRef.current = broadcast?.share_code;
  const isLiveRef = useRef(broadcast?.status === "live");
  isLiveRef.current = broadcast?.status === "live";

  useEffect(() => {
    if (!broadcast || broadcast.status !== "live") return;

    const interval = setInterval(async () => {
      if (!isLiveRef.current || !shareCodeRef.current) {
        clearInterval(interval);
        return;
      }
      const updated = await getBroadcastByCode(shareCodeRef.current);
      if (updated) {
        setBroadcast(updated);
        if (updated.status === "ended") {
          clearInterval(interval);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [broadcast?.id]);

  // ===== 読み込み中 =====
  if (loadingBroadcast) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ===== 配信が見つからない =====
  if (notFound || !broadcast) {
    return (
      <div className="mx-auto max-w-sm px-5 py-20 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-6">
          <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <h1 className="text-base font-bold">配信が見つかりません</h1>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          共有コード「{code.toUpperCase()}」に該当する配信はありません。<br />
          コードが正しいか確認してください。
        </p>
        <a
          href="/"
          className="inline-block mt-6 text-xs text-[#e63946] hover:underline"
        >
          トップに戻る
        </a>
      </div>
    );
  }

  const isLive = broadcast.status === "live";

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      {/* 共有コード表示 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-gray-600">共有コード:</span>
        <span className="text-xs font-bold tracking-widest">{broadcast.share_code}</span>
        {!isLive && (
          <span className="text-[9px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded ml-1">
            配信終了
          </span>
        )}
      </div>

      {/* メイン映像エリア */}
      <div className="aspect-[16/9] bg-[#111] rounded-lg border border-white/5 flex items-center justify-center relative overflow-hidden">
        {isLive ? (
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
        ) : (
          <div className="text-center">
            <p className="text-sm text-gray-500">この配信は終了しました</p>
            <p className="text-[10px] text-gray-600 mt-1">アーカイブ機能は準備中です</p>
          </div>
        )}

        {/* 左上: スコアボード */}
        <div className="absolute top-3 left-3 flex items-center">
          <div className="flex items-center bg-black/80 backdrop-blur-sm rounded overflow-hidden text-[10px] sm:text-xs">
            <div className="flex items-center gap-1.5 bg-white/10 px-2 sm:px-3 py-1.5">
              <span className="font-bold">{broadcast.home_team}</span>
            </div>
            <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-[#e63946]">
              <span className="font-black tabular-nums">{broadcast.home_score}</span>
              <span className="text-[8px] text-white/60">-</span>
              <span className="font-black tabular-nums">{broadcast.away_score}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/10 px-2 sm:px-3 py-1.5">
              <span className="font-bold">{broadcast.away_team}</span>
            </div>
            <div className="px-2 sm:px-3 py-1.5 bg-black/60">
              <span className="tabular-nums font-medium">{broadcast.period}</span>
            </div>
          </div>
        </div>

        {/* 右上: 大会名 + LIVE */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {(broadcast.tournament || broadcast.sport) && (
            <div className="bg-black/80 backdrop-blur-sm rounded px-2 sm:px-3 py-1.5 text-[9px] sm:text-[10px] text-gray-300">
              {broadcast.tournament || broadcast.sport}
            </div>
          )}
          {isLive ? (
            <div className="flex items-center gap-1 bg-[#e63946] px-2 py-1.5 rounded text-[9px] sm:text-[10px] font-bold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </div>
          ) : (
            <div className="bg-gray-600 px-2 py-1.5 rounded text-[9px] sm:text-[10px] font-bold">
              終了
            </div>
          )}
        </div>
      </div>

      {/* 試合情報 */}
      <div className="mt-4 rounded-md bg-[#111] border border-white/5 px-4 py-3">
        <p className="text-[9px] text-gray-600">試合情報</p>
        <p className="text-sm font-medium mt-1">
          {broadcast.home_team} vs {broadcast.away_team}
        </p>
        <div className="flex items-center gap-3 mt-1">
          {broadcast.sport && (
            <span className="text-[10px] text-gray-500">{broadcast.sport}</span>
          )}
          {broadcast.tournament && (
            <span className="text-[10px] text-gray-500">{broadcast.tournament}</span>
          )}
          {broadcast.venue && (
            <span className="text-[10px] text-gray-500">{broadcast.venue}</span>
          )}
        </div>
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

            <div className="mt-6 space-y-2.5">
              <a
                href="/mypage"
                className="flex items-center justify-center gap-3 w-full bg-white text-black text-sm font-semibold py-3 rounded-md hover:bg-gray-200 transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Googleで登録して視聴する
              </a>
              <a
                href="/mypage"
                className="flex items-center justify-center gap-3 w-full bg-[#06C755] text-white text-sm font-semibold py-3 rounded-md hover:bg-[#05b34c] transition"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z"/></svg>
                LINEで登録して視聴する
              </a>
              <a
                href="/mypage"
                className="flex items-center justify-center gap-3 w-full bg-[#1877F2] text-white text-sm font-semibold py-3 rounded-md hover:bg-[#1565c0] transition"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Facebookで登録して視聴する
              </a>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[10px] text-gray-600">または</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <a
                href="/mypage"
                className="mt-3 flex items-center justify-center gap-2 w-full border border-white/10 text-gray-300 text-sm font-semibold py-3 rounded-md hover:bg-white/5 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                メールアドレスで登録して視聴する
              </a>
              <p className="text-center text-[10px] text-gray-500 mt-2">
                視聴は完全無料です
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
