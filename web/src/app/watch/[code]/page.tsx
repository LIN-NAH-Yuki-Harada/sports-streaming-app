"use client";

import { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
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
  const [videoPaused, setVideoPaused] = useState(false);
  const { stageRef, isFullscreen, isFakeFullscreen, toggleFullscreen } =
    useStageFullscreen<HTMLDivElement>();

  // ステージ内の <video> 要素の一時停止状態を追従。
  // LiveKit 再接続で video 要素が再生成された場合に備えて、現在 attach 済みの要素を
  // ref で追跡し、二重登録 / 古い要素のリスナー残留を防ぐ。
  useEffect(() => {
    if (!isWatching || !viewerToken) return;
    const stage = stageRef.current;
    if (!stage) return;

    let attachedVideo: HTMLVideoElement | null = null;
    const onPause = () => setVideoPaused(true);
    const onPlay = () => setVideoPaused(false);

    function detach() {
      if (attachedVideo) {
        attachedVideo.removeEventListener("pause", onPause);
        attachedVideo.removeEventListener("play", onPlay);
        attachedVideo = null;
      }
    }

    function attach(): boolean {
      const video = stage!.querySelector("video");
      if (!video) return false;
      if (video === attachedVideo) return true; // 既に attach 済み
      detach(); // 古い要素のリスナーを必ず解除してから新しく登録
      video.addEventListener("pause", onPause);
      video.addEventListener("play", onPlay);
      attachedVideo = video;
      setVideoPaused(video.paused);
      return true;
    }

    attach();
    // LiveKit が <video> を再生成するケースを継続的に拾うために MutationObserver を維持。
    // disconnect は cleanup でのみ行う（一度 attach できたら止める設計だと、再接続で
    // 新しい video が登場した時に検知できなくなる）
    const observer = new MutationObserver(() => attach());
    observer.observe(stage, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      detach();
    };
  }, [isWatching, viewerToken, stageRef]);

  function handleResumeVideo() {
    const video = stageRef.current?.querySelector("video") as
      | HTMLVideoElement
      | null;
    video?.play().catch(() => {});
  }

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

  // 配信経過時間は配信者側で映像に焼き込み済み（scoreboard-canvas.ts）。
  // 視聴者側 CSS オーバーレイは廃止したのでここでの計算は不要。
  // （履歴: 2026-04-25 一度 CSS 表示したが、iOS 純正全画面で見えないため焼き込みに統一）

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
      // unsubscribe を先に呼んで以降の payload コールバックを止めてから removeChannel する。
      // これで素早い broadcast 切替時に古い subscription が新 state を上書きする事故を防ぐ
      channel.unsubscribe().catch(() => {});
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
        {isWatching && viewerToken && isLive ? (
          // 視聴者が「自社プレイヤーで見る」を選択中（WebRTC、リアルタイム）
          <LiveKitViewer
            token={viewerToken}
            serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
          />
        ) : isLive && broadcast.live_youtube_broadcast_id ? (
          // 配信中 + チームプラン配信（YouTube Live 同時配信あり）→ YouTube Live iframe を
          // デフォルト視聴経路にする。BAND 同等の視聴安定性を狙うオーナー判断（5/10）に基づき、
          // 上り帯域変動・simulcast の影響を受けない HLS/DASH 配信を視聴側のデフォルトに。
          // 5-15 秒の遅延が発生するが、ユーザー認識上「リアルタイム」に含まれる範囲
          // （feedback_realtime_user_perception.md / 5/10 確立）。リアルタイム性を優先したい
          // 視聴者は右下のボタンから自社プレイヤー（WebRTC、0.25s 遅延）に切替可能。
          <>
            <iframe
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube.com/embed/${broadcast.live_youtube_broadcast_id}?rel=0&autoplay=1`}
              title={`${broadcast.home_team} vs ${broadcast.away_team} ライブ`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            {/* リアルタイム視聴に切替（自社プレイヤー / WebRTC）。視聴遅延 0.25s だが
                配信者の上り帯域次第で画質変動が起きる。デフォルトの YouTube は安定性優先 */}
            <button
              onClick={handleStartWatching}
              className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 bg-black/60 hover:bg-black/80 text-white text-[10px] sm:text-xs font-medium px-2.5 py-1.5 rounded-md backdrop-blur transition"
              aria-label="自社プレイヤー（リアルタイム）で見る"
            >
              <span aria-hidden="true">⚡</span> リアルタイム視聴に切替
            </button>
          </>
        ) : isLive ? (
          // 配信中 + YouTube 同時配信なし（配信者プラン ¥300 等）→ 自社プレイヤー WebRTC 起動ボタン
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
        ) : broadcast.youtube_video_id ? (
          // 配信終了 + YouTube アーカイブあり → iframe 埋め込み
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube.com/embed/${broadcast.youtube_video_id}?rel=0`}
            title={`${broadcast.home_team} vs ${broadcast.away_team} アーカイブ`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <div className="text-center px-6 max-w-md">
            <p className="text-sm text-gray-400">この配信は終了しました</p>
            <p className="text-[10px] text-gray-600 mt-1 mb-5">ご視聴ありがとうございました</p>

            {/* 明示的な「ホームへ戻る」ボタン（LP 宣伝の前に配置して戻り導線を分かりやすく） */}
            <Link
              href="/"
              className="block w-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-semibold py-3 rounded-md text-center transition mb-6"
            >
              ← ホームへ戻る
            </Link>

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

        {/* 右上: LIVE / 終了 バッジ（スコアボードと大会名は映像に焼き込み済みなので CSS 側は不要） */}
        <div
          className="absolute right-2 flex items-center gap-1.5 z-[2]"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          {isLive ? (
            <div className="flex items-center gap-1 bg-[#e63946] px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-bold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </div>
          ) : (
            // 配信終了状態のバッジはタップ可能にしてホームへ戻れるようにする。
            // ただの表示ラベルだとユーザーが押して反応がないことに困惑するため。
            <Link
              href="/"
              aria-label="ホームへ戻る"
              className="bg-gray-600 hover:bg-gray-500 active:bg-gray-700 px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-bold transition"
            >
              終了
            </Link>
          )}
        </div>

        {/* 中央: 再生ボタン（video が一時停止状態の救済 — iOS 全画面解除後など） */}
        {isWatching && viewerToken && videoPaused && (
          <button
            onClick={handleResumeVideo}
            aria-label="再生"
            className="absolute inset-0 z-[3] flex items-center justify-center bg-black/40 backdrop-blur-[2px] transition"
          >
            <span className="w-20 h-20 rounded-full bg-[#e63946]/90 flex items-center justify-center shadow-2xl">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}

        {/* 配信時間は映像に焼き込み済み（scoreboard-canvas.ts）。CSS オーバーレイは廃止 */}

        {/* 右下: コントロール群（視聴中のみ表示） */}
        {isWatching && viewerToken && (
          <div className="absolute bottom-3 right-3 z-[2] flex items-center gap-2">
            {/* 視聴を終了する: setIsWatching(false) で LiveKitViewer をアンマウント
                → リスナー接続が自動切断 → 「タップして視聴」状態に戻り、再開可能 */}
            <button
              onClick={() => setIsWatching(false)}
              aria-label="視聴を終了する"
              className="flex items-center gap-1.5 h-9 px-3 rounded-md bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              <span className="text-[11px] font-semibold">視聴を終了</span>
            </button>
            {/* 全画面表示 */}
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "全画面を解除" : "全画面表示"}
              className="w-9 h-9 flex items-center justify-center rounded-md bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white transition"
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
          </div>
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
            youtubeUrl={
              // 配信中: live_youtube_broadcast_id（同時配信中の YouTube Live URL）
              // 終了後: youtube_video_id（アーカイブ動画 URL）
              broadcast.live_youtube_broadcast_id
                ? `https://youtu.be/${broadcast.live_youtube_broadcast_id}`
                : broadcast.youtube_video_id
                  ? `https://youtu.be/${broadcast.youtube_video_id}`
                  : null
            }
          />
        </div>
      </div>

    </div>
  );
}
