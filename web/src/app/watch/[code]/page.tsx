"use client";

import { useState, useEffect, useRef, use } from "react";
import { getBroadcastByCode, type Broadcast } from "@/lib/database";
import { createClient } from "@/lib/supabase";
import { LiveKitViewer } from "@/components/livekit-video";
import { Logo } from "@/components/logo";
import { ShareButtons } from "@/components/share-buttons";
import { useStageFullscreen } from "@/lib/use-stage-fullscreen";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

export default function WatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [loadingBroadcast, setLoadingBroadcast] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [viewerToken, setViewerToken] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const { stageRef, isFullscreen, isFakeFullscreen, toggleFullscreen } =
    useStageFullscreen<HTMLDivElement>();

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

  // 視聴開始（LiveKitトークン取得）
  async function handleStartWatching() {
    if (!broadcast) return;
    const viewerIdentity = `viewer-${Math.random().toString(36).slice(2, 9)}`;
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: broadcast.share_code,
          participantIdentity: viewerIdentity,
          participantName: "視聴者",
          role: "viewer",
        }),
      });
      if (!res.ok) {
        throw new Error(`Token API error: ${res.status}`);
      }
      const { token } = await res.json();
      setViewerToken(token);
      setIsWatching(true);
    } catch (e) {
      console.error("視聴トークン取得エラー:", e);
    }
  }

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
      <div>
        <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
          <div className="flex items-center justify-between">
            <Logo />
            <h1 className="text-sm font-bold text-gray-400">視聴</h1>
          </div>
        </div>
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

        {/* リトライ: 別のコードで再検索 */}
        <div className="mt-6 flex gap-2 max-w-xs mx-auto">
          <input
            type="text"
            placeholder="コードを再入力"
            maxLength={8}
            onChange={(e) => {
              const el = e.target as HTMLInputElement;
              el.value = el.value.toUpperCase();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) window.location.href = `/watch/${val}`;
              }
            }}
            className="flex-1 bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition tracking-widest"
          />
          <button
            onClick={(e) => {
              const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
              const val = input?.value.trim();
              if (val) window.location.href = `/watch/${val}`;
            }}
            className="shrink-0 px-4 py-2.5 rounded-md bg-[#e63946] text-white text-sm font-semibold hover:bg-[#d62836] transition"
          >
            視聴
          </button>
        </div>

        <a
          href="/"
          className="inline-block mt-4 text-xs text-gray-500 hover:text-white transition"
        >
          トップに戻る
        </a>
      </div>
      </div>
    );
  }

  const isLive = broadcast.status === "live";

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* メイン映像エリア — 画面全体を使用 */}
      <div
        ref={stageRef}
        className={
          isFakeFullscreen
            ? "fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden"
            : "relative flex-1 bg-black flex items-center justify-center overflow-hidden"
        }
        style={isFakeFullscreen ? undefined : { minHeight: "60vh" }}
      >
        {isWatching && viewerToken ? (
          <LiveKitViewer
            token={viewerToken}
            serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
          />
        ) : isLive ? (
          <button
            onClick={handleStartWatching}
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
          <div className="text-center px-6 max-w-md">
            <p className="text-sm text-gray-400">この配信は終了しました</p>
            <p className="text-[10px] text-gray-600 mt-1 mb-6">ご視聴ありがとうございました</p>

            {/* LIVE SPOtCH 宣伝 */}
            <div className="bg-[#111] border border-white/10 rounded-xl p-5 text-left">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-[#e63946] flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold">LIVE SPOtCH</p>
                  <p className="text-[9px] text-gray-500">ローカルスポーツ配信アプリ</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                お子さんの試合、あなたも配信しませんか？スマホ1台でTV中継風のスコアボード付きライブ配信ができます。
              </p>
              <div className="mt-4 space-y-2">
                <a
                  href="/broadcast"
                  className="block w-full bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 rounded-md text-center transition"
                >
                  配信をはじめる（初回10分間無料）
                </a>
                <a
                  href="/"
                  className="block w-full border border-white/10 text-gray-300 text-xs font-semibold py-2.5 rounded-md text-center hover:bg-white/5 transition"
                >
                  LIVE SPOtCH について詳しく見る
                </a>
              </div>
              <div className="mt-3 pt-3 border-t border-white/5">
                <p className="text-[10px] text-gray-500 font-medium mb-1.5">配信者プラン</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-black">¥300</span>
                  <span className="text-[10px] text-gray-500">/月</span>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[10px] text-gray-500">
                  <li>✓ スコアボード・オーバーレイ</li>
                  <li>✓ リモコンでスコア操作</li>
                  <li>✓ 限定公開の共有コード発行</li>
                  <li>✓ アーカイブ自動保存</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 左上: スコアボード */}
        <div
          className="absolute left-2 flex flex-col items-start gap-1 z-[2]"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          <div className="flex items-center bg-black/80 backdrop-blur-sm rounded overflow-hidden text-[9px] sm:text-[10px]">
            <div className="flex items-center gap-1 bg-white/10 px-1.5 sm:px-2 py-1">
              <span className="font-bold">{broadcast.home_team}</span>
              {(broadcast.home_sets > 0 || broadcast.away_sets > 0) && (
                <span className="text-[7px] text-yellow-400 font-bold">{broadcast.home_sets}</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 px-1.5 sm:px-2 py-1 bg-[#e63946]">
              <span className="font-black tabular-nums">{broadcast.home_score}</span>
              <span className="text-[7px] text-white/60">-</span>
              <span className="font-black tabular-nums">{broadcast.away_score}</span>
            </div>
            <div className="flex items-center gap-1 bg-white/10 px-1.5 sm:px-2 py-1">
              {(broadcast.home_sets > 0 || broadcast.away_sets > 0) && (
                <span className="text-[7px] text-yellow-400 font-bold">{broadcast.away_sets}</span>
              )}
              <span className="font-bold">{broadcast.away_team}</span>
            </div>
            <div className="px-1.5 sm:px-2 py-1 bg-black/60">
              <span className="tabular-nums font-medium">{broadcast.period}</span>
            </div>
          </div>
        </div>

        {/* 右上: 大会名 + LIVE */}
        <div
          className="absolute right-2 flex items-center gap-1.5 z-[2]"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          {(broadcast.tournament || broadcast.sport) && (
            <div className="bg-black/80 backdrop-blur-sm rounded px-1.5 sm:px-2 py-1 text-[8px] sm:text-[9px] text-gray-300">
              {broadcast.tournament || broadcast.sport}
            </div>
          )}
          {isLive ? (
            <div className="flex items-center gap-1 bg-[#e63946] px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-bold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </div>
          ) : (
            <div className="bg-gray-600 px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-bold">
              終了
            </div>
          )}
        </div>

        {/* 右下: 全画面ボタン（視聴中のみ表示） */}
        {isWatching && viewerToken && (
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "全画面を解除" : "全画面表示"}
            className="absolute bottom-3 right-3 z-[2] w-9 h-9 flex items-center justify-center rounded-md bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white transition"
          >
            {isFullscreen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4M9 9H4M15 9V4M15 9h5M9 15v5M9 15H4M15 15v5M15 15h5" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* 試合情報（映像下部） */}
      <div className="bg-[#0a0a0a] border-t border-white/5 px-5 py-3">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {broadcast.home_team} vs {broadcast.away_team}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              {broadcast.sport && (
                <span className="text-[10px] text-gray-500">{broadcast.sport}</span>
              )}
              {broadcast.tournament && (
                <span className="text-[10px] text-gray-500">{broadcast.tournament}</span>
              )}
              {broadcast.venue && (
                <span className="text-[10px] text-gray-500">{broadcast.venue}</span>
              )}
              <span className="text-[10px] text-gray-600 tracking-widest">
                {broadcast.share_code}
              </span>
            </div>
          </div>
          <ShareButtons
            url={
              typeof window !== "undefined"
                ? window.location.href
                : `${SITE_URL}/watch/${broadcast.share_code}`
            }
            title={`【試合配信${broadcast.status === "live" ? "中" : "アーカイブ"}】${broadcast.home_team} vs ${broadcast.away_team}`}
            description={
              [
                broadcast.tournament,
                broadcast.sport,
                `スコア ${broadcast.home_score}-${broadcast.away_score}`,
              ]
                .filter(Boolean)
                .join(" / ")
            }
          />
        </div>
      </div>

    </div>
  );
}
