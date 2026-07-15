"use client";

import { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getBroadcastByCode,
  getStreamPlaybackUrl,
  updateBroadcastNotice,
  type Broadcast,
} from "@/lib/database";
import { createClient } from "@/lib/supabase";
import { LiveKitViewer } from "@/components/livekit-video";
import { HlsPlayer } from "@/components/hls-player";
import { ViewerScoreboardOverlay } from "@/components/viewer-scoreboard-overlay";
import { Logo } from "@/components/logo";
import { ShareButtons } from "@/components/share-buttons";
import { LiveReactions } from "@/components/live-reactions";
import { AdSlot } from "@/components/ad-slot";
import { useStageFullscreen } from "@/lib/use-stage-fullscreen";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

// HLS視聴は映像が数秒〜10秒遅延するため、リアルタイムのスコアをそのまま重ねると
// 得点が映像より先に出る（ネタバレ）。スコアオーバーレイを映像の遅延ぶん遅らせて同期する。
// ※固定値（平均的なHLSライブ遅延）。ズレが残るならこの値を調整。LiveKit経路は ~リアルタイム
//   なので遅延させない（HLS分岐のみ delayedBroadcast を渡す）。
const OVERLAY_DELAY_MS = 7000;

// broadcast を delayMs ぶん遅らせて返す（スコア表示を映像に同期させるため）。
function useDelayedBroadcast(
  broadcast: Broadcast | null,
  delayMs: number,
): Broadcast | null {
  const [delayed, setDelayed] = useState<Broadcast | null>(broadcast);
  const queueRef = useRef<{ value: Broadcast; at: number }[]>([]);
  useEffect(() => {
    if (broadcast) queueRef.current.push({ value: broadcast, at: Date.now() });
  }, [broadcast]);
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - delayMs;
      const q = queueRef.current;
      let chosen: Broadcast | null = null;
      let pruneTo = 0;
      for (let i = 0; i < q.length; i++) {
        if (q[i].at <= cutoff) {
          chosen = q[i].value;
          pruneTo = i;
        } else break;
      }
      if (chosen) {
        if (pruneTo > 0) queueRef.current = q.slice(pruneTo);
        setDelayed(chosen);
      }
    }, 500);
    return () => clearInterval(id);
  }, [delayMs]);
  return delayed;
}

export default function WatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [loadingBroadcast, setLoadingBroadcast] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [viewerToken, setViewerToken] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  // 自前配信サーバー(MediaMTX)の HLS 視聴 URL。set されていれば HLS プレイヤーで直接再生
  // （タップ不要・スコアは映像に焼き込み済み）。null なら従来 LiveKit 経路。
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [videoPaused, setVideoPaused] = useState(false);
  // 配信者本人（ログイン済み）だけに出すお知らせ編集 UI 用。
  // アプリから配信中の人が別端末のブラウザで自分の視聴ページを開いて操作する経路。
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [showNoticePanel, setShowNoticePanel] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState("");

  // ログイン中ユーザーを一度だけ取得（配信者本人ならお知らせ編集 UI を出す。未ログインなら null のまま）
  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setViewerUserId(data.user?.id ?? null))
      .catch(() => setViewerUserId(null));
  }, []);
  // 焼き込み OFF の配信は、スコアが映像に乗っていないので視聴側 CSS オーバーレイで表示する。
  // その場合 iPhone は「動画ネイティブ全画面」だと HTML オーバーレイが消えるため、
  // フェイク全画面（CSS）に切り替える（allowVideoFallback=false）。
  // 焼き込みありの従来配信（既定 true）は従来どおりネイティブ全画面を許可。
  const scoreboardBurnedIn = broadcast?.scoreboard_burned_in ?? true;
  const router = useRouter();
  // HLS視聴用：映像遅延に合わせてスコアを遅らせた broadcast（同期表示）
  const delayedBroadcast = useDelayedBroadcast(broadcast, OVERLAY_DELAY_MS);
  const { stageRef, isFullscreen, isFakeFullscreen, toggleFullscreen } =
    useStageFullscreen<HTMLDivElement>({
      allowVideoFallback: scoreboardBurnedIn,
      // Android 視聴者は端末を横にしたら自動で没入横画面に（iOS は既存挙動を維持）。
      autoLandscapeFullscreen: isWatching,
    });

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

  const isOwner =
    !!broadcast && !!viewerUserId && broadcast.broadcaster_id === viewerUserId;

  // 配信者本人によるお知らせテロップ更新（RLS で本人以外は書き込み不可）。
  // text=null で非表示。反映は Realtime でも届くが、体感を良くするため楽観更新もする。
  async function applyNotice(text: string | null) {
    if (!broadcast) return;
    const trimmed = text?.trim() || null;
    const ok = await updateBroadcastNotice(broadcast.id, trimmed);
    if (ok) {
      setBroadcast((prev) => (prev ? { ...prev, notice: trimmed } : prev));
      setNoticeDraft("");
      setShowNoticePanel(false);
    }
  }

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
        // 自前サーバー配信なら HLS 視聴URLを取得（migration未適用環境では null）
        if (data.status === "live") {
          getStreamPlaybackUrl(code).then(setHlsUrl).catch(() => {});
        }
      } else {
        setNotFound(true);
      }
      setLoadingBroadcast(false);
    }
    fetchBroadcast();
  }, [code]);

  // スコア表示の出し分け（発熱対策 Phase 1-A・2026-06-08）:
  // - 焼き込みあり配信（scoreboard_burned_in=true・従来/¥500）: スコアは映像に焼き込み済み
  //   → 視聴側オーバーレイ不要。
  // - 焼き込み OFF 配信（¥300 等）: スコアは映像に乗らない → ViewerScoreboardOverlay を重ねる。
  //   iPhone 全画面で消えないよう、上で allowVideoFallback=false（フェイク全画面）にしている。
  // （履歴: 2026-04-25 に一度 CSS を廃止し焼き込みへ統一したが、発熱対策で CSS 経路を再導入）

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
        // 配信開始がページ読み込み後の場合に備え、HLS URL も追従取得
        if (updated.status === "live") {
          getStreamPlaybackUrl(updated.share_code).then(setHlsUrl).catch(() => {});
        }
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
  // 終了後のYouTubeアーカイブ動画ID。youtube_video_id は egress_ended webhook が
  // コピーするまで遅延するため、live配信が正常終了(live_status='ended')していれば
  // live_youtube_broadcast_id（=同じ動画ID）をフォールバックに使い、即アーカイブ誘導する。
  const archiveYoutubeId =
    broadcast.youtube_video_id ??
    (broadcast.live_status === "ended"
      ? broadcast.live_youtube_broadcast_id
      : null);

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
        {isLive && hlsUrl ? (
          // 自前配信サーバー(MediaMTX)の HLS を直接再生。タップ不要で自動再生。
          // スコアは端末焼き込み(プレーンテキスト)ではなく、視聴側で CSS の綺麗な
          // オーバーレイ(配信者画面と同デザイン・DBからリアルタイム)を重ねる。
          // ＝端末は焼き込みOFF(scoreboardVisible=false)・provision は burned_in=false。
          <>
            <HlsPlayer src={hlsUrl} />
            {!scoreboardBurnedIn && (
              <ViewerScoreboardOverlay broadcast={delayedBroadcast ?? broadcast} />
            )}
          </>
        ) : isWatching && viewerToken && isLive ? (
          // 視聴者が「自社プレイヤーで見る」を選択中（WebRTC、リアルタイム）
          <>
            <LiveKitViewer
              token={viewerToken}
              serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
            />
            {/* 焼き込み OFF の配信はスコアを CSS オーバーレイで重ねる（発熱対策 Phase 1-A）。
                焼き込みありの配信は映像にスコアが乗っているので描画しない（二重表示防止）。 */}
            {!scoreboardBurnedIn && <ViewerScoreboardOverlay broadcast={broadcast} />}
          </>
        ) : isLive ? (
          // 配信中 → 自社プレイヤー（WebRTC）が常時デフォルト。
          // 過去（5/10 PR #124）はチームプラン配信を YouTube iframe デフォルトにしていたが、
          // selfDeclaredMadeForKids:true の YouTube Live は他サイトへの埋め込みが
          // 構造的に許可されず iframe で「他のウェブサイトでの再生は無効」エラーが出るため、
          // 自社プレイヤーをデフォルトに戻し、YouTube 視聴はサブ経路としてリンク化する。
          // （5/28 PR #134 で enableEmbed:true を試したが Made for Kids と衝突して
          // broadcast 作成が全件失敗 → 5/30 hotfix PR #140 で revert 済）
          <div className="flex flex-col items-center gap-4 group">
            <button
              onClick={handleStartWatching}
              className="flex flex-col items-center gap-3"
              aria-label="自社プレイヤーで視聴開始"
            >
              <div className="w-16 h-16 rounded-full bg-[#e63946] flex items-center justify-center group-hover:bg-[#d62836] transition shadow-lg shadow-[#e63946]/20">
                <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <span className="text-xs text-gray-400">タップして視聴</span>
            </button>
            {broadcast.live_youtube_broadcast_id && (
              <a
                href={`https://www.youtube.com/watch?v=${broadcast.live_youtube_broadcast_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                YouTubeで見る（別タブ）
              </a>
            )}
          </div>
        ) : archiveYoutubeId ? (
          // 配信終了 + YouTube アーカイブあり
          // ※ Made for Kids 配信のアーカイブは iframe 埋め込みが拒否されるため、
          //   YouTube で開くリンクをメインの導線として置く（iframe での再生失敗を回避）。
          <div className="flex flex-col items-center gap-5 px-6 max-w-sm text-center">
            <div className="w-16 h-16 rounded-full bg-[#1a0608] border border-[#e63946]/40 flex items-center justify-center">
              <svg className="w-7 h-7 text-[#e63946]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">YouTube にアーカイブがあります</p>
              <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                試合のアーカイブは YouTube 上で公開されています。<br />
                下のボタンから YouTube を開いてご視聴ください。
              </p>
            </div>
            <a
              href={`https://www.youtube.com/watch?v=${archiveYoutubeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-5 py-2.5 rounded-md transition"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube で視聴する
            </a>
            {/* ブランクタイムCM枠（アーカイブ導線画面）。フラグOFF/在庫なし時は非表示。 */}
            <div className="w-full pt-1">
              <AdSlot placement="archive_pre" sport={broadcast.sport} />
            </div>
          </div>
        ) : (
          <div className="text-center px-6 max-w-md">
            <p className="text-sm text-gray-400">この配信は終了しました</p>
            <p className="text-[10px] text-gray-600 mt-1 mb-5">ご視聴ありがとうございました</p>

            {/* ブランクタイムCM枠（postroll）。フラグOFF/在庫なし時は何も描画しない。 */}
            <div className="mb-6">
              <AdSlot placement="postroll" sport={broadcast.sport} />
            </div>

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
                {/* pricing ページの配信者プラン表記と同期（リモコンは未実装・アーカイブはチームプラン限定のため誤表記に注意） */}
                <ul className="mt-1.5 space-y-0.5 text-[10px] text-gray-500">
                  <li>✓ 無制限ライブ配信</li>
                  <li>✓ スコアボード・オーバーレイ（手動入力）</li>
                  <li>✓ 限定公開の共有コード発行</li>
                  <li>✓ LINE ワンタップ共有</li>
                  <li className="text-gray-600">※ アーカイブ保存はチームプラン限定</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 上部中央: 配信者からのお知らせテロップ（Realtime で即時反映・null で非表示）。
            焼き込みあり/なし・LiveKit/HLS のどの経路でも CSS オーバーレイとして重ねる。 */}
        {isLive && broadcast.notice && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-[2] max-w-[60%] bg-black/70 backdrop-blur-sm border border-[#e63946]/60 rounded-md px-3 py-1.5 text-[11px] sm:text-xs text-white text-center leading-snug"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
          >
            <span className="mr-1">📢</span>
            {broadcast.notice}
          </div>
        )}

        {/* 配信者本人だけのお知らせ編集パネル（アプリ配信中に別端末のブラウザから操作する経路） */}
        {isLive && isOwner && showNoticePanel && (
          <div
            className="absolute right-2 z-[4] w-60 bg-black/85 backdrop-blur-sm rounded-lg p-2.5 border border-white/10"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 44px)" }}
          >
            <p className="text-[10px] text-gray-400 mb-1.5">視聴者へのお知らせ（配信者のみ表示）</p>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={noticeDraft}
                onChange={(e) => setNoticeDraft(e.target.value)}
                maxLength={30}
                placeholder="自由入力（30文字まで）"
                className="flex-1 min-w-0 h-8 rounded bg-white/10 px-2 text-[11px] placeholder:text-gray-500 outline-none focus:bg-white/15"
              />
              <button
                onClick={() => applyNotice(noticeDraft)}
                disabled={!noticeDraft.trim()}
                className="h-8 px-2 rounded bg-[#e63946] hover:bg-[#d62836] disabled:opacity-30 disabled:cursor-not-allowed text-[10px] font-bold transition active:scale-95"
              >
                表示
              </button>
            </div>
            {broadcast.notice && (
              <button
                onClick={() => applyNotice(null)}
                className="mt-1.5 w-full h-7 rounded bg-white/10 hover:bg-white/20 text-[10px] text-gray-300 transition active:scale-95"
              >
                お知らせを消す
              </button>
            )}
          </div>
        )}

        {/* 右上: LIVE / 終了 バッジ（スコアボードと大会名は映像に焼き込み済みなので CSS 側は不要） */}
        <div
          className="absolute right-2 flex items-center gap-1.5 z-[2]"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          {isLive && isOwner && (
            <button
              onClick={() => setShowNoticePanel((v) => !v)}
              aria-label="視聴者へのお知らせを設定"
              title="視聴者へのお知らせ"
              className={`h-6 px-1.5 rounded text-[11px] transition ${
                broadcast.notice
                  ? "bg-[#e63946]/40"
                  : "bg-black/60 hover:bg-black/80"
              }`}
            >
              📢
            </button>
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

        {/* スコア/経過時間は、焼き込みあり配信では映像内、焼き込み OFF 配信では
            ViewerScoreboardOverlay（ステージ内に重畳）で表示する。 */}

        {/* 右下: コントロール群（LiveKit視聴中 or HLS再生中に表示） */}
        {((isWatching && viewerToken) || (isLive && hlsUrl)) && (
          <div className="absolute bottom-3 right-3 z-[2] flex items-center gap-2">
            {/* 視聴を終了する:
                - LiveKit: setIsWatching(false) でアンマウント→「タップして視聴」に戻り再開可能
                - HLS(自前配信): 自動再生で「タップして視聴」状態が無いため、ホームへ戻る */}
            <button
              onClick={() => {
                if (isWatching) setIsWatching(false);
                else router.push("/");
              }}
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

        {/* ライブ応援スタンプ（❤️/👍・配信中のみ・全視聴者と配信者にリアルタイム共有） */}
        {isLive && <LiveReactions shareCode={broadcast.share_code} />}
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
