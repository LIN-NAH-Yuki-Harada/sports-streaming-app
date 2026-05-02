"use client";

import { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
import { PlanTeaser } from "@/components/plan-teaser";
import { LiveKitBroadcaster } from "@/components/livekit-video";
import { CameraPermissionGuide, isCameraPermissionError } from "@/components/camera-permission-guide";
import { useToast } from "@/components/toaster";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase";
import {
  createBroadcast,
  updateBroadcastScore,
  endBroadcast,
  cleanupStaleBroadcasts,
  type Broadcast,
  type Team,
} from "@/lib/database";
import { pickBroadcastResolution } from "@/lib/user-agent";
import type { ScoreboardState } from "@/lib/scoreboard-canvas";
import { useStageFullscreen } from "@/lib/use-stage-fullscreen";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];

// 配信時間を「X時間Y分Z秒」形式に整形（配信終了サマリモーダル表示用）
function formatBroadcastDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}時間${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

// 配信中のオーバーレイ用に MM:SS / H:MM:SS のコンパクト時計形式へ整形
function formatElapsedClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

// バレーボールのルール設定
const VOLLEYBALL_RULES: Record<string, {
  setsToWin: number;
  setPoint: number;
  finalSetPoint: number;
  periods: string[];
}> = {
  "小学生6人制": { setsToWin: 2, setPoint: 21, finalSetPoint: 15, periods: ["1SET", "2SET", "3SET"] },
  "6人制":      { setsToWin: 3, setPoint: 25, finalSetPoint: 15, periods: ["1SET", "2SET", "3SET", "4SET", "5SET"] },
  "9人制":      { setsToWin: 2, setPoint: 21, finalSetPoint: 21, periods: ["1SET", "2SET", "3SET"] },
};
const VOLLEYBALL_RULE_NAMES = Object.keys(VOLLEYBALL_RULES);

// 野球のルール設定
function generateBaseballPeriods(innings: number): string[] {
  const periods: string[] = [];
  for (let i = 1; i <= innings; i++) {
    periods.push(`${i}回表`, `${i}回裏`);
  }
  periods.push("延長");
  return periods;
}

const BASEBALL_RULES: Record<string, { innings: number; periods: string[] }> = {
  "学童（5回）": { innings: 5, periods: generateBaseballPeriods(5) },
  "学童（6回）": { innings: 6, periods: generateBaseballPeriods(6) },
  "中学（7回）": { innings: 7, periods: generateBaseballPeriods(7) },
  "高校以上（9回）": { innings: 9, periods: generateBaseballPeriods(9) },
};
const BASEBALL_RULE_NAMES = Object.keys(BASEBALL_RULES);

const PERIODS: Record<string, string[]> = {
  サッカー: ["前半", "後半", "延長"],
  バスケ: ["1Q", "2Q", "3Q", "4Q", "OT"],
  陸上: ["競技中"],
  その他: ["前半", "後半", "延長"],
};

type Screen = "login" | "form" | "live";

export default function BroadcastPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <BroadcastPageInner />
    </Suspense>
  );
}

function BroadcastPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  const toast = useToast();
  const subscribed = profile?.plan === "broadcaster" || profile?.plan === "team";
  // 累積トライアル: profile.trial_seconds_used (0〜600) を元に残秒を算出
  const trialSecondsUsed = profile?.trial_seconds_used ?? 0;
  const trialSecondsRemainingInitial = Math.max(0, 600 - trialSecondsUsed);
  const trialExhausted = trialSecondsRemainingInitial <= 0;

  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  // 所属チーム取得
  useEffect(() => {
    if (!user) return;
    const fetchTeams = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/teams", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        setMyTeams(json.teams || []);
      } catch { /* ignore */ }
    };
    fetchTeams();
  }, [user]);

  // スケジュールから遷移してきた場合、URLパラメータで所属チームを自動選択
  useEffect(() => {
    const tid = searchParams.get("teamId");
    if (tid && myTeams.find((t) => t.id === tid)) {
      setSelectedTeamId(tid);
    }
  }, [searchParams, myTeams]);

  const [sport, setSport] = useState("サッカー");
  const [volleyballRule, setVolleyballRule] = useState("6人制");
  const [baseballRule, setBaseballRule] = useState("高校以上（9回）");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [tournament, setTournament] = useState("");
  const [venue, setVenue] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [copied, setCopied] = useState("");
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [showCameraGuide, setShowCameraGuide] = useState(false);
  const [homeSets, setHomeSets] = useState(0);
  const [awaySets, setAwaySets] = useState(0);
  const [setResults, setSetResults] = useState<{ home: number; away: number }[]>([]);
  // 配信終了後に表示するサマリモーダル用の state（次のアクションへの導線として使う）
  const [endedSummary, setEndedSummary] = useState<{
    durationSec: number;
    broadcastId: string | null;
    archiveEligible: boolean;
  } | null>(null);
  const [archiveDiscarded, setArchiveDiscarded] = useState(false);
  const [discardingArchive, setDiscardingArchive] = useState(false);
  // 今回の配信で YouTube Live 同時配信を使うかどうか（配信ごとの都度判断）。
  // マイページの youtube_live_enabled が ON のときデフォルト true、ユーザーは
  // 配信開始前にチェックを外して「今回は YouTube に出さない」を選べる。
  // ref は handleStart / handleEnd / pagehide で常に最新値を読むため。
  const [enableYouTubeLiveSession, setEnableYouTubeLiveSession] = useState(true);
  const enableYouTubeLiveSessionRef = useRef(true);
  useEffect(() => {
    enableYouTubeLiveSessionRef.current = enableYouTubeLiveSession;
  }, [enableYouTubeLiveSession]);
  // /api/livekit/live/start のレスポンスから受け取る YouTube Live broadcast ID。
  // 配信中の LINE 共有テキストに「📺 YouTube版」リンクを差し込むために使う。
  // 配信終了時に null リセット。
  const [liveYoutubeBroadcastId, setLiveYoutubeBroadcastId] = useState<string | null>(null);
  // 配信開始時に決定した「新パイプラインを使ったか」を保持する。
  // 開始時 enableYouTubeLiveSession の値で start API を分岐したのと整合する
  // stop API を呼ぶため、フォーム画面に戻ってから enableYouTubeLiveSession が
  // 変わっても影響を受けないように ref で固定する。
  const usingLivePipelineRef = useRef(false);

  // スケジュールから遷移してきた場合、フォームを事前入力
  useEffect(() => {
    const s = searchParams.get("sport");
    if (s && SPORTS.includes(s)) setSport(s);
    const h = searchParams.get("home");
    if (h) setHome(h);
    const a = searchParams.get("away");
    if (a) setAway(a);
    const t = searchParams.get("tournament");
    if (t) setTournament(t);
    const v = searchParams.get("venue");
    if (v) setVenue(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 無料お試しタイマー（秒数）
  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);

  // DB上の配信データ
  const broadcastRef = useRef<Broadcast | null>(null);
  // スコア更新のデバウンス用
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LiveKit 接続成功後の「実際の配信開始時刻」— カメラ映像が出始めた瞬間にセット。
  // この時点からトライアル消費カウントが始まる（接続失敗時は null のまま＝消費ゼロ）。
  const streamStartedAtRef = useRef<number | null>(null);
  // 配信開始時点の trial_seconds_used スナップショット（refreshProfile されても表示がブレないように）
  const trialSnapshotRef = useRef<number>(0);

  // スコアUndo用の履歴スタック（最大10件）
  type ScoreSnapshot = {
    homeScore: number;
    awayScore: number;
    homeSets: number;
    awaySets: number;
    setResults: { home: number; away: number }[];
    periodIndex: number;
  };
  const historyRef = useRef<ScoreSnapshot[]>([]);
  const [historyLength, setHistoryLength] = useState(0);
  const MAX_HISTORY = 10;

  const vbRule = sport === "バレー" ? VOLLEYBALL_RULES[volleyballRule] : null;
  const bbRule = sport === "野球" ? BASEBALL_RULES[baseballRule] : null;
  const periods = sport === "バレー"
    ? (vbRule?.periods || ["1SET", "2SET", "3SET"])
    : sport === "野球"
      ? (bbRule?.periods || generateBaseballPeriods(9))
      : (PERIODS[sport] || PERIODS["その他"]);
  const currentPeriod = periods[periodIndex] || periods[0];

  const canStart = home.trim() && away.trim();
  const needsSubscription = !subscribed && trialExhausted;

  // セットポイント・マッチポイント判定
  function getPointLabel(): string | null {
    if (!vbRule) return null;

    const { setsToWin, setPoint, finalSetPoint } = vbRule;

    // 最終セット判定
    const isFinalSet = (homeSets + awaySets) >= (setsToWin * 2 - 2);
    const targetScore = isFinalSet ? finalSetPoint : setPoint;

    // セットポイント条件: 規定点-1以上 かつ 相手より1点以上リード
    const homeAtSetPoint = homeScore >= targetScore - 1 && homeScore > awayScore;
    const awayAtSetPoint = awayScore >= targetScore - 1 && awayScore > homeScore;

    if (!homeAtSetPoint && !awayAtSetPoint) return null;

    // マッチポイント: このセットを取れば試合勝利
    if ((homeAtSetPoint && homeSets >= setsToWin - 1) ||
        (awayAtSetPoint && awaySets >= setsToWin - 1)) {
      return "マッチポイント";
    }
    return "セットポイント";
  }

  const pointLabel = getPointLabel();

  // スコアボード焼き込み: 2026-04-25 検証完了後、デフォルト ON に切替（PR #28→#29 経由）。
  // 緊急時は `?burn=0` で旧経路（LiveKit 自動 publish + 視聴側 CSS オーバーレイ）にロールバック可能。
  const burnScoreboard = searchParams.get("burn") !== "0";
  const broadcastResolutionRef = useRef<ReturnType<typeof pickBroadcastResolution> | null>(null);
  if (broadcastResolutionRef.current === null) {
    broadcastResolutionRef.current = pickBroadcastResolution();
  }
  const broadcastResolution = broadcastResolutionRef.current;

  // 配信経過時間（焼き込み用）— started_at を state で保持して effect の依存にする
  // （ref 経由だとマウント直後のタイミングで未取得になり得る）
  const [broadcastStartedAt, setBroadcastStartedAt] = useState<string | null>(null);
  const [broadcastElapsed, setBroadcastElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (!broadcastStartedAt) {
      setBroadcastElapsed(null);
      return;
    }
    const startedAtMs = new Date(broadcastStartedAt).getTime();
    if (Number.isNaN(startedAtMs)) {
      setBroadcastElapsed(null);
      return;
    }
    function compute() {
      setBroadcastElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    }
    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [broadcastStartedAt]);

  const scoreboardState: ScoreboardState = {
    home_team: home || "HOME",
    away_team: away || "AWAY",
    home_score: homeScore,
    away_score: awayScore,
    home_sets: homeSets,
    away_sets: awaySets,
    period: currentPeriod,
    tournament: tournament || null,
    sport,
    pointLabel,
    elapsedSeconds: broadcastElapsed,
  };

  // 配信中ステージの全画面化（Safari URL バー・タブバーを隠して画面を最大化）。
  // 配信ページの主役は canvas で video は隠し source なので、video 全画面フォールバックは
  // 無効化する（iPhone Safari では Fake Fullscreen にフォールバック）。
  const {
    stageRef: liveStageRef,
    isFullscreen: isLiveFullscreen,
    isFakeFullscreen: isLiveFakeFullscreen,
    toggleFullscreen: toggleLiveFullscreen,
  } = useStageFullscreen<HTMLDivElement>({ allowVideoFallback: false });

  function getScreen(): Screen {
    if (!user) return "login";
    if (shareCode) return "live";
    return "form";
  }

  // スコアをDBに保存（デバウンス付き: 500ms 待ってからまとめて送信）
  const saveScoreToDb = useCallback(
    (newHomeScore: number, newAwayScore: number, newPeriod: string, newHomeSets?: number, newAwaySets?: number, newSetResults?: { home: number; away: number }[]) => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(async () => {
        if (broadcastRef.current) {
          await updateBroadcastScore(
            broadcastRef.current.id,
            newHomeScore,
            newAwayScore,
            newPeriod,
            newHomeSets,
            newAwaySets,
            newSetResults
          );
        }
      }, 500);
    },
    []
  );

  // 履歴に現在のスコア状態をpush
  function pushHistory() {
    historyRef.current.push({
      homeScore,
      awayScore,
      homeSets,
      awaySets,
      setResults: [...setResults],
      periodIndex,
    });
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    setHistoryLength(historyRef.current.length);
  }

  // Undo: 直前のスコア状態に戻す
  function undoScore() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setHistoryLength(historyRef.current.length);
    setHomeScore(prev.homeScore);
    setAwayScore(prev.awayScore);
    setHomeSets(prev.homeSets);
    setAwaySets(prev.awaySets);
    setSetResults(prev.setResults);
    setPeriodIndex(prev.periodIndex);
    // 即座にDBへ反映（デバウンスを待たない）
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    if (broadcastRef.current) {
      updateBroadcastScore(
        broadcastRef.current.id,
        prev.homeScore,
        prev.awayScore,
        periods[prev.periodIndex] || periods[0],
        prev.homeSets,
        prev.awaySets,
        prev.setResults,
      );
    }
    toast.info("1つ戻しました");
  }

  // スコア変更ハンドラー
  function changeHomeScore(delta: number) {
    pushHistory();
    const newScore = Math.max(0, homeScore + delta);
    setHomeScore(newScore);
    saveScoreToDb(newScore, awayScore, currentPeriod);
  }

  function changeAwayScore(delta: number) {
    pushHistory();
    const newScore = Math.max(0, awayScore + delta);
    setAwayScore(newScore);
    saveScoreToDb(homeScore, newScore, currentPeriod);
  }

  function changePeriod(newIndex: number) {
    pushHistory();
    const clamped = Math.max(0, Math.min(periods.length - 1, newIndex));
    setPeriodIndex(clamped);
    const newPeriod = periods[clamped] || periods[0];
    saveScoreToDb(homeScore, awayScore, newPeriod);
  }

  // 配信開始
  async function handleStart() {
    if (!canStart || needsSubscription || !user) return;
    setStarting(true);

    // 同じページセッションで 2 本目以降の配信を始めるとき、前回の broadcast 由来の
    // ref が残っていると handleLiveKitConnected が早期リターンして Egress が起動しない。
    // consumeTrialElapsed は subscribed ユーザーで早期リターンするためここでリセットしない
    // と一生 null に戻らない。明示的に冒頭でリセットする。
    streamStartedAtRef.current = null;
    trialSnapshotRef.current = 0;

    try {
      // DBに保存（共有コードは自動生成・衝突時リトライ付き）
      const broadcast = await createBroadcast({
        userId: user.id,
        sport,
        homeTeam: home.trim(),
        awayTeam: away.trim(),
        tournament: tournament.trim() || undefined,
        venue: venue.trim() || undefined,
        period: periods[0],
        teamId: selectedTeamId || undefined,
      });

      if (broadcast) {
        broadcastRef.current = broadcast;
        setShareCode(broadcast.share_code);
        setBroadcastStartedAt(broadcast.started_at);

        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        // トライアル消費は LiveKit 接続成功時（handleLiveKitConnected）に開始する。
        // ここで markTrialUsed を呼ばない → カメラ許可失敗や接続失敗時に無駄に消費しない。

        // LiveKitトークンを取得
        try {
          if (!accessToken) {
            throw new Error("No access token");
          }
          const res = await fetch("/api/livekit/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              roomName: broadcast.share_code,
              participantIdentity: user.id,
              participantName: profile?.display_name || "配信者",
              role: "broadcaster",
            }),
          });
          if (!res.ok) {
            throw new Error(`Token API error: ${res.status}`);
          }
          const { token } = await res.json();
          setLivekitToken(token);
        } catch (e) {
          console.error("LiveKitトークン取得エラー:", e);
          setLivekitError("映像配信の準備に失敗しました");
          // DB 上の broadcast を終了させて status=live が残らないようにする
          // （ここで終了させないと再配信時に古い "live" 状態が衝突する）
          if (broadcastRef.current) {
            await endBroadcast(broadcastRef.current.id).catch(() => {});
            broadcastRef.current = null;
          }
          setShareCode("");
          setBroadcastStartedAt(null);
        }
      } else {
        toast.error("配信の開始に失敗しました。もう一度お試しください。");
      }
    } catch (e) {
      console.error("配信開始エラー:", e);
      toast.error("配信の開始でエラーが発生しました。");
    }

    setStarting(false);
  }

  // LiveKit 接続成功時に呼ばれる。ここから実際の配信秒数の計測が始まる。
  // 再接続時には上書きしない（セッション全体を一続きとして扱う）。
  const handleLiveKitConnected = useCallback(() => {
    if (streamStartedAtRef.current != null) return;
    streamStartedAtRef.current = Date.now();
    trialSnapshotRef.current = profile?.trial_seconds_used ?? 0;

    // YouTube アーカイブ機能 ON 時は LiveKit Egress 起動を fire-and-forget で投げる。
    // 失敗しても配信本体は止めたくないため catch は握りつぶす（API 内部で
    // failure status を DB に書き込むので後追い可能）。
    // 焼き込みパスのみ録画する（旧経路 ?burn=0 は録画対象外）。
    //
    // 新パイプライン（Live 中継）と旧パイプライン（録画→アップロード）は **排他**:
    //   - NEXT_PUBLIC_LIVE_ARCHIVE=true かつ 当該配信で同時配信 ON → /api/livekit/live/start
    //   - 上記の同時配信 OFF (=ユーザーが今回は YouTube に出さない選択) で
    //     NEXT_PUBLIC_ARCHIVE_ENABLED=true → /api/livekit/egress/start (旧アーカイブ)
    //   - どちらも該当しない → 何も呼ばない
    // 二重起動すると transcode minutes の重複消費 + DB 状態管理の混乱が起きる。
    const useLivePipeline = isLiveArchiveEnabled() && enableYouTubeLiveSessionRef.current;
    usingLivePipelineRef.current = useLivePipeline;
    const archiveStartPath = useLivePipeline
      ? "/api/livekit/live/start"
      : isArchiveEnabled()
        ? "/api/livekit/egress/start"
        : null;
    if (archiveStartPath && burnScoreboard && broadcastRef.current) {
      const broadcastId = broadcastRef.current.id;
      (async () => {
        try {
          const supabase = createClient();
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (!accessToken) return;
          const res = await fetch(archiveStartPath, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ broadcastId }),
          });
          // 新パイプラインの場合は YouTube Live broadcast ID を取得して
          // LINE 共有テキストの「📺 YouTube版」リンクに反映する
          if (res.ok && useLivePipeline) {
            const data = (await res.json().catch(() => null)) as
              | { liveBroadcastId?: string; reused?: string }
              | null;
            if (data?.liveBroadcastId) {
              setLiveYoutubeBroadcastId(data.liveBroadcastId);
            }
          }
        } catch {
          /* ignore: 録画/Live 失敗で配信を止めない */
        }
      })();
    }
  }, [profile?.trial_seconds_used, burnScoreboard]);

  // 配信終了時、実際に配信した秒数をサーバーに加算する。
  // keepalive: true はページ離脱時用（pagehide）。通常終了時は false。
  const consumeTrialElapsed = useCallback(async (accessToken: string | null, keepalive = false) => {
    if (subscribed) return;
    const startedAt = streamStartedAtRef.current;
    if (startedAt == null) return;
    // 二重送信防止：先にリセット
    streamStartedAtRef.current = null;
    if (!accessToken) return;

    const elapsedSec = Math.max(0, Math.ceil((Date.now() - startedAt) / 1000));
    if (elapsedSec === 0) return;

    try {
      await fetch("/api/broadcasts/trial-consume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        // broadcastId をサーバーに渡し、サーバー側で started_at と比較して
        // 改ざんされた seconds を実経過時間でクランプ可能にする
        body: JSON.stringify({
          seconds: elapsedSec,
          broadcastId: broadcastRef.current?.id ?? null,
        }),
        keepalive,
      });
    } catch {
      /* ignore: サーバー到達失敗でも次の操作を妨げない */
    }
  }, [subscribed]);

  // 配信終了
  async function handleEnd(options?: { skipConfirm?: boolean }) {
    if (!options?.skipConfirm && !confirm("配信を終了しますか？")) return;

    // 配信終了モーダル用に経過時間と broadcastId を確保（state リセット前に取り出す必要あり）
    const startedAtMs = broadcastStartedAt ? new Date(broadcastStartedAt).getTime() : null;
    const durationSec = startedAtMs
      ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
      : 0;
    const endedBroadcastId = broadcastRef.current?.id ?? null;
    const archiveEligible = isArchiveEnabled() && profile?.plan === "team";

    // 配信終了サマリモーダルを最初に表示する。
    // ここで先に出さないと、後続の await（getSession / endBroadcast 等）が
    // ネットワーク不調でハングしたときにモーダルが永遠に出ず UI が固まったように見える
    // （6 本目 E2E で再現した症状）。サーバー側 cleanup は cleanup cron が拾うので
    // クライアント awaits を投機的に走らせて握りつぶせる。
    setEndedSummary({
      durationSec,
      broadcastId: endedBroadcastId,
      archiveEligible,
    });
    setArchiveDiscarded(false);

    // broadcastRef を先に null 化しておく（onDisconnected が二重発火しないように）。
    // LiveKitRoom がアンマウント直前に Disconnected 状態を一瞬通過すると
    // BroadcasterRenderer の onDisconnected が発火する可能性があるため。
    broadcastRef.current = null;

    // LiveKit切断（トークンをnull化 → LiveKitRoom自動アンマウント）
    setLivekitToken(null);
    setLivekitError(null);

    // フォーム表示用 state を初期化（次の配信開始に備える）
    setShareCode("");
    setBroadcastStartedAt(null);
    setHomeScore(0);
    setAwayScore(0);
    setHomeSets(0);
    setAwaySets(0);
    setSetResults([]);
    historyRef.current = [];
    setHistoryLength(0);
    setPeriodIndex(0);
    // 次の配信に備えて Live 中継関連 state をリセット
    setLiveYoutubeBroadcastId(null);
    usingLivePipelineRef.current = false;

    // 残りのサーバー側 cleanup はバックグラウンドで実行（UI ブロックしない）。
    // どれか失敗しても DB は cleanup cron で 2 時間後に補正される。
    void (async () => {
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token ?? null;

        // 実際の配信秒数をサーバーに加算（subscribed ユーザーは consumeTrialElapsed 内で no-op）
        await consumeTrialElapsed(accessToken, false);

        // LiveKit Egress 停止を fire-and-forget で投げる（フラグ off なら API 側で noop）
        // 新旧パイプラインは排他。開始時に決定したパイプラインの stop を呼ぶ。
        const archiveStopPath = usingLivePipelineRef.current
          ? "/api/livekit/live/stop"
          : isArchiveEnabled()
            ? "/api/livekit/egress/stop"
            : null;
        if (archiveStopPath && accessToken && endedBroadcastId) {
          fetch(archiveStopPath, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ broadcastId: endedBroadcastId }),
          }).catch(() => {
            /* ignore */
          });
        }

        if (endedBroadcastId) {
          const success = await endBroadcast(endedBroadcastId);
          if (!success) {
            // モーダルは既に出ているので toast でだけ通知。DB は cleanup cron で補正。
            toast.error("配信終了の保存に失敗しました（後ほど自動補正されます）");
          }
        }

        // profile を最新化（残秒表示を更新するため）
        refreshProfile();
      } catch (e) {
        console.error("[handleEnd] background cleanup error:", e);
      }
    })();
  }

  // 配信終了モーダルで「YouTubeに保存しない」を選択したときの処理
  async function handleDiscardArchive() {
    if (!endedSummary?.broadcastId || archiveDiscarded || discardingArchive) return;
    // グレー下線リンクは反射的に踏まれやすいため、ネイティブ confirm でワンクッション挟む。
    // 4/29 本番 E2E で誤タップによる意図せぬ cancelled 事故が発生したための対策。
    if (
      !confirm(
        "YouTube に保存しません。よろしいですか？\n（この配信のアーカイブは作成されません）",
      )
    ) {
      return;
    }
    setDiscardingArchive(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("セッションが無効です");
        return;
      }
      const res = await fetch("/api/broadcasts/archive-decision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          broadcastId: endedSummary.broadcastId,
          decision: "discard",
        }),
      });
      if (res.ok) {
        setArchiveDiscarded(true);
        toast.success("YouTubeに保存しないように設定しました");
      } else {
        toast.error("設定の更新に失敗しました");
      }
    } catch {
      toast.error("エラーが発生しました");
    } finally {
      setDiscardingArchive(false);
    }
  }

  // 無料お試しカウントダウンタイマー（累積秒数ベース）
  useEffect(() => {
    if (subscribed || !shareCode) {
      setTrialRemaining(null);
      return;
    }

    const tick = () => {
      const startedAt = streamStartedAtRef.current;
      if (startedAt == null) {
        // LiveKit 接続前（カメラ許可待ち等）— カウントダウン開始前
        return;
      }
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const remaining = Math.max(0, 600 - trialSnapshotRef.current - elapsedSec);
      setTrialRemaining(Math.ceil(remaining));
      if (remaining <= 0) {
        handleEnd({ skipConfirm: true });
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribed, shareCode]);

  // ページ読み込み時に、このユーザーの放置された配信を自動終了する
  useEffect(() => {
    if (!user) return;
    cleanupStaleBroadcasts(user.id);
  }, [user?.id]);

  // ページ離脱・画面切替時に配信を自動終了する
  useEffect(() => {
    // 認証トークンを取得して保持（離脱時に非同期処理ができないため）
    const supabase = createClient();
    let accessToken: string | null = null;

    supabase.auth.getSession().then(({ data }) => {
      accessToken = data.session?.access_token ?? null;
    });

    const handlePageHide = () => {
      if (!accessToken) return;

      // broadcastRef.current は配信終了処理で null 化されるため、
      // 後段の trial-consume が broadcastId を渡せるよう先にスナップショットを取る
      const broadcastIdSnapshot = broadcastRef.current?.id ?? null;

      // 1. 配信を ended にする（既存ロジック）
      const bc = broadcastRef.current;
      if (bc) {
        fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/broadcasts?id=eq.${bc.id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ status: "ended", ended_at: new Date().toISOString() }),
            keepalive: true,
          }
        );
        // YouTube アーカイブ機能 ON 時、Egress も合わせて停止依頼。
        // keepalive: true でタブ閉じ後でも投げ切る。
        // 新旧パイプラインは排他。開始時に決定したパイプラインの stop を呼ぶ。
        const pagehideStopPath = usingLivePipelineRef.current
          ? "/api/livekit/live/stop"
          : isArchiveEnabled()
            ? "/api/livekit/egress/stop"
            : null;
        if (pagehideStopPath) {
          fetch(pagehideStopPath, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ broadcastId: bc.id }),
            keepalive: true,
          });
        }
        broadcastRef.current = null;
      }

      // 2. トライアル消費秒数を加算（無料ユーザーかつ LiveKit 接続済みのみ）
      const startedAt = streamStartedAtRef.current;
      if (startedAt != null && !subscribed) {
        const elapsedSec = Math.max(0, Math.ceil((Date.now() - startedAt) / 1000));
        streamStartedAtRef.current = null;
        if (elapsedSec > 0) {
          fetch("/api/broadcasts/trial-consume", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            // broadcastId をサーバーに渡してサーバー側 started_at とのクロスチェックを有効化
            body: JSON.stringify({
              seconds: elapsedSec,
              broadcastId: broadcastIdSnapshot,
            }),
            keepalive: true,
          });
        }
      }
    };

    // pagehide: ページが閉じられる・リロードされる時に配信を終了
    // ※ visibilitychange は使わない（通知確認や電話応答で配信が終了してしまうため）
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [subscribed]);

  function copyToClipboard(text: string, label: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(label);
        setTimeout(() => setCopied(""), 2000);
      }).catch(() => {
        setCopied("error");
        setTimeout(() => setCopied(""), 2000);
      });
    } else {
      // HTTP環境ではclipboard APIが使えない
      setCopied("error");
      setTimeout(() => setCopied(""), 2000);
    }
  }

  const screen = getScreen();

  // ブラウザUIを隠す（配信中） — フックは条件付きreturnの前に配置
  const isLiveScreen = screen === "live";
  useEffect(() => {
    if (!isLiveScreen) return;
    window.scrollTo(0, 1);
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.height = "";
    };
  }, [isLiveScreen]);

  // ===== 読み込み中 =====
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ===== 未ログイン =====
  if (screen === "login") {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
          <div className="flex items-center justify-between">
            <Logo />
            <h1 className="text-sm font-bold text-gray-400">配信</h1>
          </div>
        </div>
        <div className="mx-auto max-w-sm md:max-w-md px-5 md:px-8 py-16">
          <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#e63946]/10 flex items-center justify-center mb-6">
            <svg className="w-7 h-7 text-[#e63946]" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
            </svg>
          </div>
          <h1 className="text-lg font-bold">配信するにはログインが必要です</h1>
          <p className="mt-2 text-xs text-gray-500 leading-relaxed">
            無料のアカウント登録で、初回10分間の配信を無料でお試しいただけます。
          </p>
        </div>

        <AuthForm />

          <PlanTeaser
            contextLabel="配信は配信者プラン ¥300 から（登録で累計10分は無料お試し）"
            highlight="broadcaster"
          />
        </div>
      </div>
    );
  }

  // ===== 配信中（フルスクリーン） =====
  if (screen === "live") {
    const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/watch/${shareCode}`;
    return (
      <div
        className={
          isLiveFakeFullscreen
            ? "fixed inset-0 z-[9999] bg-black"
            : "fixed inset-0 z-[60] bg-black"
        }
        style={isLiveFakeFullscreen ? undefined : { height: "100dvh" }}
      >
        <div
          ref={liveStageRef}
          className="relative w-full h-full bg-[#0a0a0a] overflow-hidden"
        >
          {/* LiveKit映像レイヤー */}
          {livekitToken ? (
            <LiveKitBroadcaster
              token={livekitToken}
              serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
              onConnected={handleLiveKitConnected}
              onDisconnected={() => {
                // 配信中の予期しない WebRTC 切断（Safari メモリ圧迫等）。
                // ユーザー起点 handleEnd は事前に setLivekitToken(null) でアンマウントするため、
                // ここに到達するのは「配信中に意図せず切れた」場合のみ。
                // broadcasts.status='live' が永遠に残らないように DB を ended に補正する。
                const stranded = broadcastRef.current;
                if (!stranded) return;
                broadcastRef.current = null;
                void endBroadcast(stranded.id);
                toast.error("配信が中断されました（自動で終了処理を行いました）");
                setShareCode("");
                setBroadcastStartedAt(null);
                setLivekitToken(null);
                setLivekitError(null);
                streamStartedAtRef.current = null;
                trialSnapshotRef.current = 0;
              }}
              onError={(e) => {
                console.error("LiveKitエラー:", e);
                if (isCameraPermissionError(e)) {
                  setShowCameraGuide(true);
                  setLivekitError(null);
                } else {
                  setLivekitError("映像配信でエラーが発生しました。ページを再読み込みしてください。");
                }
              }}
              burnScoreboard={burnScoreboard}
              scoreboardState={scoreboardState}
              broadcastResolution={broadcastResolution}
            />
          ) : livekitError ? (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="max-w-xs text-center space-y-3">
                <p className="text-sm font-semibold text-[#e63946]">配信エラー</p>
                <p className="text-xs text-gray-300 leading-relaxed">{livekitError}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2 px-4 py-2 rounded-md bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold"
                >
                  再読み込み
                </button>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-gray-600">カメラを準備中...</p>
              </div>
            </div>
          )}

          {/* 左上: スコアボード・オーバーレイ（焼き込み時は canvas 内に同じ内容を描画するので非表示） */}
          {!burnScoreboard && (
            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 flex flex-col items-start gap-1">
              <div className="flex items-center bg-black/70 backdrop-blur-sm rounded overflow-hidden text-[10px] sm:text-xs">
                <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 flex items-center gap-1.5">
                  <span className="font-bold">{home}</span>
                  {(homeSets > 0 || awaySets > 0) && (
                    <span className="text-[8px] text-yellow-400 font-bold">{homeSets}</span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-[#e63946]">
                  <span className="font-black tabular-nums">{homeScore}</span>
                  <span className="text-[8px] text-white/60">-</span>
                  <span className="font-black tabular-nums">{awayScore}</span>
                </div>
                <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 flex items-center gap-1.5">
                  {(homeSets > 0 || awaySets > 0) && (
                    <span className="text-[8px] text-yellow-400 font-bold">{awaySets}</span>
                  )}
                  <span className="font-bold">{away}</span>
                </div>
                <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-black/60">
                  <span className="tabular-nums font-medium">{currentPeriod}</span>
                </div>
              </div>
              {/* セットポイント・マッチポイント表示 */}
              {pointLabel && (
                <div className="bg-yellow-500 text-black px-2 py-0.5 rounded text-[9px] font-bold animate-pulse">
                  {pointLabel}
                </div>
              )}
            </div>
          )}

          {/* スコア操作パネル — 縦画面では2段構成 */}
          <div className="absolute bottom-[calc(12px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm rounded-lg px-2 sm:px-3 py-2 max-w-[95vw]">
            {/* スコア行 */}
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-gray-400 max-w-[50px] truncate text-right">{home}</span>
                <button
                  onClick={() => changeHomeScore(-1)}
                  className="w-10 h-10 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  −
                </button>
                <span className="text-lg font-black tabular-nums w-6 text-center">{homeScore}</span>
                <button
                  onClick={() => changeHomeScore(1)}
                  className="w-10 h-10 rounded bg-[#e63946] hover:bg-[#d62836] flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  +
                </button>
              </div>

              <span className="text-gray-600 text-xs">-</span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => changeAwayScore(-1)}
                  className="w-10 h-10 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  −
                </button>
                <span className="text-lg font-black tabular-nums w-6 text-center">{awayScore}</span>
                <button
                  onClick={() => changeAwayScore(1)}
                  className="w-10 h-10 rounded bg-[#e63946] hover:bg-[#d62836] flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  +
                </button>
                <span className="text-[9px] text-gray-400 max-w-[50px] truncate">{away}</span>
              </div>
            </div>
            {/* ピリオド行 */}
            <div className="flex items-center justify-center gap-2 mt-1.5">
              <button
                onClick={undoScore}
                disabled={historyLength === 0}
                className="h-8 px-2 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1 text-[10px] text-gray-300 transition active:scale-90"
                aria-label="直前のスコア操作を取り消す"
                title="Undo"
              >
                <span className="text-sm leading-none">↶</span>
                <span>戻す</span>
              </button>
              <span className="text-gray-600 text-xs mx-0.5">|</span>
              <button
                onClick={() => changePeriod(periodIndex - 1)}
                className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm transition active:scale-90"
                aria-label="前のピリオドへ"
              >
                ‹
              </button>
              <span className="text-[10px] font-medium min-w-[40px] text-center">{currentPeriod}</span>
              <button
                onClick={() => changePeriod(periodIndex + 1)}
                className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm transition active:scale-90"
                aria-label="次のピリオドへ"
              >
                ›
              </button>
              <span className="text-gray-600 text-xs mx-1">|</span>
              <button
                onClick={() => {
                  pushHistory();
                  const nextIndex = Math.min(periodIndex + 1, periods.length - 1);
                  // セットスコアを記録
                  const newSetResults = [...setResults, { home: homeScore, away: awayScore }];
                  setSetResults(newSetResults);
                  // セット獲得数を更新（スコアが高い方が勝ち）
                  let newHomeSets = homeSets;
                  let newAwaySets = awaySets;
                  if (homeScore > awayScore) {
                    newHomeSets = homeSets + 1;
                    setHomeSets(newHomeSets);
                  } else if (awayScore > homeScore) {
                    newAwaySets = awaySets + 1;
                    setAwaySets(newAwaySets);
                  }
                  setPeriodIndex(nextIndex);
                  setHomeScore(0);
                  setAwayScore(0);
                  saveScoreToDb(0, 0, periods[nextIndex] || periods[0], newHomeSets, newAwaySets, newSetResults);
                }}
                className="px-2 h-6 rounded bg-yellow-500/20 hover:bg-yellow-500/30 flex items-center justify-center text-[9px] text-yellow-400 font-medium transition active:scale-95"
              >
                次へ 0-0
              </button>
            </div>
          </div>

          {/* 右上: 全画面ボタン + 大会名 + LIVE + お試し表示 */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleLiveFullscreen}
              aria-label={isLiveFullscreen ? "全画面を解除" : "全画面表示"}
              className="w-8 h-8 flex items-center justify-center rounded bg-black/70 hover:bg-black/90 backdrop-blur-sm text-white transition"
            >
              {isLiveFullscreen ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4M9 9H4M15 9V4M15 9h5M9 15v5M9 15H4M15 15v5M15 15h5" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                </svg>
              )}
            </button>
            {broadcastElapsed !== null && (
              <div
                className="bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-[10px] sm:text-[11px] font-semibold text-white tabular-nums"
                aria-label="配信経過時間"
              >
                {formatElapsedClock(broadcastElapsed)}
              </div>
            )}
            {!subscribed && trialRemaining !== null && (
              <div className={`backdrop-blur-sm rounded px-2 py-1 text-[9px] font-medium ${trialRemaining <= 60 ? "bg-red-500/30 text-red-400 animate-pulse" : "bg-yellow-500/20 text-yellow-500"}`}>
                残り {Math.floor(trialRemaining / 60)}:{String(trialRemaining % 60).padStart(2, "0")}
              </div>
            )}
            {!burnScoreboard && (tournament || sport) && (
              <div className="bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-[9px] sm:text-[10px] text-gray-300">
                {tournament || sport}
              </div>
            )}
            <div className="flex items-center gap-1 bg-[#e63946] px-2 py-1 rounded text-[9px] sm:text-[10px] font-bold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </div>
          </div>

          {/* 左下: 共有コード */}
          <div className="absolute bottom-[calc(8px+env(safe-area-inset-bottom))] left-3 sm:bottom-4 sm:left-4">
            <button
              onClick={() => {
                const matchup = home && away ? `${home} vs ${away}` : "試合";
                const tournamentLine = tournament ? `\n${tournament}` : "";
                const youtubeWatchUrl = liveYoutubeBroadcastId
                  ? `https://youtu.be/${liveYoutubeBroadcastId}`
                  : null;
                const youtubeBlock = youtubeWatchUrl
                  ? `\n\n📺 YouTube版\n${youtubeWatchUrl}`
                  : "";
                const msg = `【LIVE SPOtCH 試合配信中】${tournamentLine}\n${matchup}\n\n📱 より高画質・リアルタイム視聴（推奨）\n${shareUrl}${youtubeBlock}\n\n共有コード: ${shareCode}`;
                copyToClipboard(msg, "code");
              }}
              className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded px-2 sm:px-3 py-1.5 transition hover:bg-black/90"
            >
              <span className="text-[9px] text-gray-400">共有コード</span>
              <span className="text-xs sm:text-sm font-black tracking-widest tabular-nums">{shareCode}</span>
              <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
            </button>
            {copied === "code" && (
              <p className="text-[9px] text-green-400 mt-1 ml-1">コピーしました</p>
            )}
            {copied === "error" && (
              <p className="text-[9px] text-yellow-400 mt-1 ml-1">HTTPS環境でコピーが有効になります</p>
            )}
          </div>

          {/* 右下: コントロールボタン群 */}
          <div className="absolute bottom-[calc(8px+env(safe-area-inset-bottom))] right-3 sm:bottom-4 sm:right-4 flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const youtubeWatchUrl = liveYoutubeBroadcastId
                  ? `https://youtu.be/${liveYoutubeBroadcastId}`
                  : null;
                const tournamentLine = tournament ? `${tournament}\n` : "";
                const youtubeBlock = youtubeWatchUrl
                  ? `\n\n📺 YouTube版\n${youtubeWatchUrl}`
                  : "";
                const text = `【試合配信中】\n${home} vs ${away}\n${tournamentLine}\n📱 より高画質・リアルタイム視聴（推奨）\n${shareUrl}${youtubeBlock}`;

                // iOS Safari の Native Share API を最優先。
                // ネイティブシェアシートは Safari のオーバーレイ UI として開くため、
                // Safari 自体がバックグラウンドにならず WebRTC publish が切断されない。
                // 配信中の LINE アプリ起動は WebRTC を確実に切るため必ず避ける。
                if (typeof navigator !== "undefined" && "share" in navigator) {
                  try {
                    await (
                      navigator as Navigator & {
                        share: (data: ShareData) => Promise<void>;
                      }
                    ).share({
                      title: home && away ? `${home} vs ${away}` : "LIVE SPOtCH 試合配信中",
                      text,
                    });
                    return;
                  } catch {
                    // ユーザーがキャンセル or share API 失敗 → フォールバック
                  }
                }

                // フォールバック: Native Share 非対応端末 (PC ブラウザ等) 向けに
                // LINE 共有 URL を開く。配信中 iOS Safari ではここに到達しない想定。
                window.open(
                  `https://line.me/R/share?text=${encodeURIComponent(text)}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
              className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] active:bg-[#04a043] rounded px-2 sm:px-3 py-1.5 transition"
              aria-label="配信を共有する"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
              </svg>
              <span className="text-[10px] font-semibold">共有</span>
            </button>

            {!subscribed && (
              <a
                href="/pricing"
                className="flex items-center gap-1 bg-[#e63946] hover:bg-[#d62836] rounded px-2 sm:px-3 py-1.5 transition text-[10px] font-semibold"
              >
                プランに登録
              </a>
            )}

            <button
              onClick={() => handleEnd()}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 active:bg-red-700 rounded-md px-3 sm:px-4 py-2 transition shadow-lg shadow-red-900/40 ring-1 ring-red-400/30"
              aria-label="配信を終了する"
            >
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
              <span className="text-xs sm:text-sm text-white font-bold whitespace-nowrap">配信終了</span>
            </button>
          </div>
        </div>

        {/* カメラ許可拒否時のガイド */}
        <CameraPermissionGuide
          open={showCameraGuide}
          onClose={() => setShowCameraGuide(false)}
        />
      </div>
    );
  }

  // ===== 入力フォーム（ログイン済み）=====
  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <div className="flex items-center justify-between">
          <Logo />
          <h1 className="text-sm font-bold text-gray-400">配信</h1>
        </div>
      </div>
      <div className="mx-auto md:max-w-2xl px-5 md:px-8 py-10 md:py-12 pb-20">
      <h1 className="text-lg md:text-xl font-bold">配信をはじめる</h1>
      <p className="mt-1 text-xs md:text-sm text-gray-500">
        試合情報を入力して配信を開始すると、共有コードが発行されます。
      </p>

      {needsSubscription && (
        <div className="mt-4 rounded-lg border border-[#e63946]/30 bg-[#e63946]/5 p-4">
          <p className="text-xs text-[#e63946] font-medium">無料お試しは終了しました</p>
          <p className="text-[10px] text-gray-400 mt-1">
            配信を続けるには、配信者プラン（¥300/月）への登録が必要です。
          </p>
          <button className="mt-3 w-full bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 rounded-md transition">
            配信者プランに登録（¥300/月）
          </button>
        </div>
      )}

      <div className="mt-8 space-y-5">
        {/* 種目 */}
        <fieldset>
          <legend className="text-[11px] text-gray-400 font-medium mb-2">種目</legend>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setSport(s); setPeriodIndex(0); setHomeSets(0); setAwaySets(0); }}
                className={`text-xs px-3 py-1.5 rounded-md border transition ${
                  sport === s
                    ? "border-[#e63946] text-[#e63946] bg-[#e63946]/10"
                    : "border-white/10 text-gray-400 hover:border-white/20"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>

        {/* バレーボールルール選択 */}
        {sport === "バレー" && (
          <fieldset>
            <legend className="text-[11px] text-gray-400 font-medium mb-2">ルール</legend>
            <div className="flex flex-wrap gap-2">
              {VOLLEYBALL_RULE_NAMES.map((rule) => {
                const r = VOLLEYBALL_RULES[rule];
                return (
                  <button
                    key={rule}
                    type="button"
                    onClick={() => { setVolleyballRule(rule); setPeriodIndex(0); setHomeSets(0); setAwaySets(0); }}
                    className={`text-xs px-3 py-1.5 rounded-md border transition ${
                      volleyballRule === rule
                        ? "border-[#e63946] text-[#e63946] bg-[#e63946]/10"
                        : "border-white/10 text-gray-400 hover:border-white/20"
                    }`}
                  >
                    {rule}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9px] text-gray-600">
              {vbRule && `${vbRule.setsToWin * 2 - 1}セットマッチ / ${vbRule.setPoint}点制 / 最終セット${vbRule.finalSetPoint}点`}
            </p>
          </fieldset>
        )}

        {/* 野球ルール選択 */}
        {sport === "野球" && (
          <fieldset>
            <legend className="text-[11px] text-gray-400 font-medium mb-2">ルール</legend>
            <div className="flex flex-wrap gap-2">
              {BASEBALL_RULE_NAMES.map((rule) => (
                <button
                  key={rule}
                  type="button"
                  onClick={() => { setBaseballRule(rule); setPeriodIndex(0); }}
                  className={`text-xs px-3 py-1.5 rounded-md border transition ${
                    baseballRule === rule
                      ? "border-[#e63946] text-[#e63946] bg-[#e63946]/10"
                      : "border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  {rule}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {/* 所属チームから選択 */}
        {myTeams.length > 0 && (
          <fieldset>
            <legend className="text-[11px] text-gray-400 font-medium mb-2">所属チームから選択</legend>
            <select
              value={selectedTeamId}
              onChange={(e) => {
                const teamId = e.target.value;
                setSelectedTeamId(teamId);
                if (teamId) {
                  const team = myTeams.find((t) => t.id === teamId);
                  if (team) {
                    setHome(team.name);
                    const sportMatch = SPORTS.find((s) => team.sport.includes(s));
                    if (sportMatch) setSport(sportMatch);
                  }
                }
              }}
              className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-[#e63946]/50 focus:outline-none transition"
            >
              <option value="">選択しない（手動入力）</option>
              {myTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}（{t.sport}）</option>
              ))}
            </select>
          </fieldset>
        )}

        {/* チーム */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] text-gray-400 font-medium">チーム名</label>
            <input
              type="text"
              placeholder="あなたのチーム名"
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-medium">対戦相手</label>
            <input
              type="text"
              placeholder="対戦相手のチーム名"
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
            />
          </div>
        </div>

        {/* 大会・会場 */}
        <div>
          <label className="text-[11px] text-gray-400 font-medium">大会名</label>
          <input
            type="text"
            placeholder="任意"
            value={tournament}
            onChange={(e) => setTournament(e.target.value)}
            className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-400 font-medium">会場</label>
          <input
            type="text"
            placeholder="任意"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
          />
        </div>

        {/* スコアボードプレビュー */}
        <div>
          <p className="text-[11px] text-gray-400 font-medium mb-2">オーバーレイ プレビュー</p>
          <div className="rounded-md bg-[#111] border border-white/10 p-4 relative aspect-[16/9] overflow-hidden">
            <p className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-700">実際の配信画面イメージ</p>

            <div className="absolute top-3 left-3 flex items-center">
              <div className="flex items-center bg-black/80 backdrop-blur-sm rounded overflow-hidden text-[9px]">
                <div className="px-2 py-1 bg-white/10">
                  <span className="font-bold">{home || "ホーム"}</span>
                </div>
                <div className="flex items-center gap-0.5 px-2 py-1 bg-[#e63946]">
                  <span className="font-black tabular-nums">0</span>
                  <span className="text-[7px] text-white/60">-</span>
                  <span className="font-black tabular-nums">0</span>
                </div>
                <div className="px-2 py-1 bg-white/10">
                  <span className="font-bold">{away || "アウェイ"}</span>
                </div>
                <div className="px-2 py-1 bg-black/60">
                  <span className="tabular-nums font-medium">{periods[0]}</span>
                </div>
              </div>
            </div>

            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <div className="bg-black/80 backdrop-blur-sm rounded px-2 py-1 text-[8px] text-gray-300">
                {tournament || sport || "大会名"}
              </div>
              <div className="flex items-center gap-1 bg-[#e63946] px-1.5 py-1 rounded text-[8px] font-bold">
                <span className="w-1 h-1 bg-white rounded-full" />
                LIVE
              </div>
            </div>
          </div>
          <p className="mt-1.5 text-[9px] text-gray-600">
            視聴者にはこのようにスコアボードが映像の上にオーバーレイ表示されます
          </p>
        </div>

        {/* YouTube Live 同時配信トグル（チームプラン + マイページ ON のとき表示）。
            マイページの youtube_live_enabled が機能利用許諾のマスタースイッチ、
            このチェックは「今回の配信で使うかどうか」の都度判断。 */}
        {isLiveArchiveEnabled()
          && profile?.youtube_live_enabled === true
          && profile?.plan === "team" && (
          <div className="rounded-md bg-red-500/5 border border-red-500/20 px-3 py-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enableYouTubeLiveSession}
                onChange={(e) => setEnableYouTubeLiveSession(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-white/20 bg-black/40 accent-[#e63946] cursor-pointer"
              />
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-white flex items-center gap-1.5">
                  📺 YouTube Live で同時配信する
                  <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-medium">ベータ</span>
                </p>
                <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
                  ON にするとあなたのYouTubeチャンネルにリアルタイム配信され、終了後は自動でアーカイブが残ります（限定公開）。OFF にすると今回の配信は YouTube に保存されません。
                </p>
              </div>
            </label>
          </div>
        )}

        {/* 配信前チェックリスト（発熱対策） */}
        <details className="rounded-md bg-amber-500/5 border border-amber-500/20 group">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] font-medium text-amber-200 flex items-center justify-between select-none">
            <span className="flex items-center gap-2">
              <span aria-hidden="true">🌡️</span>
              <span>配信前のチェック（夏・屋外は要確認）</span>
            </span>
            <span className="text-amber-300/60 text-[10px] group-open:rotate-180 transition-transform" aria-hidden="true">▼</span>
          </summary>
          <div className="px-3 pb-3 text-[10px] text-gray-300 leading-relaxed space-y-2.5">
            <p className="text-amber-100/90">スマホの発熱で配信が止まるのを防ぐため、開始前にご確認ください。</p>
            <div>
              <p className="text-amber-200 font-semibold mb-1">📱 端末</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>ケースを外す（特にシリコン・厚手革は熱が溜まります）</li>
                <li>フル充電してからケーブルを抜いて配信（充電しながらは熱が倍増）</li>
              </ul>
            </div>
            <div>
              <p className="text-amber-200 font-semibold mb-1">🌞 環境</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>直射日光・車内・人工芝の照り返しを避ける</li>
                <li>体育館内では日陰側に立つ</li>
              </ul>
            </div>
            <div>
              <p className="text-amber-200 font-semibold mb-1">📶 通信</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>5G より WiFi または 4G が安定（5G モデムは発熱大）</li>
              </ul>
            </div>
            <div>
              <p className="text-amber-200 font-semibold mb-1">❄️ おすすめアクセサリ</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>モバイル冷却ファン（¥2,000〜）で大幅に安定します</li>
              </ul>
            </div>
          </div>
        </details>

        {/* 配信ボタン */}
        <button
          disabled={!canStart || needsSubscription || starting}
          onClick={handleStart}
          className="w-full bg-[#e63946] text-white text-sm font-semibold py-3 rounded-md transition mt-2 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-[#d62836]"
        >
          {starting
            ? "配信を準備中..."
            : !subscribed && trialSecondsRemainingInitial > 0
              ? trialSecondsRemainingInitial === 600
                ? "配信をスタート（10分間無料お試し）"
                : `配信をスタート（残り ${Math.floor(trialSecondsRemainingInitial / 60)}:${String(trialSecondsRemainingInitial % 60).padStart(2, "0")} 無料）`
              : "配信をスタート"}
        </button>
        {!canStart && (
          <p className="text-center text-[10px] text-[#e63946]/60">
            チーム名と対戦相手を入力してください
          </p>
        )}
      </div>
      </div>

      {/* 配信終了サマリモーダル: 配信終了直後に「次に何をするか」を明示する導線 */}
      {endedSummary && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setEndedSummary(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="broadcast-ended-title"
        >
          <div
            className="bg-[#0a0a0a] rounded-2xl ring-1 ring-white/10 max-w-sm w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="text-4xl mb-2" aria-hidden="true">🎉</div>
              <h2 id="broadcast-ended-title" className="text-lg font-bold text-white">
                配信を終了しました
              </h2>
              <p className="text-sm text-gray-400 mt-1">お疲れさまでした！</p>
            </div>

            {endedSummary.durationSec > 0 && (
              <div className="mt-5 bg-white/5 rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest">配信時間</p>
                <p className="text-2xl font-bold text-white tabular-nums mt-1">
                  {formatBroadcastDuration(endedSummary.durationSec)}
                </p>
              </div>
            )}

            {/* YouTube アーカイブ可否（チームプランかつフラグONのとき） */}
            {endedSummary.archiveEligible && (
              <div className="mt-4 bg-[#e63946]/5 ring-1 ring-[#e63946]/20 rounded-lg p-3">
                {!archiveDiscarded ? (
                  <>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      📹 この配信は YouTube に限定公開で自動保存されます
                    </p>
                    <button
                      onClick={handleDiscardArchive}
                      disabled={discardingArchive}
                      className="mt-2 text-[11px] text-gray-500 hover:text-red-400 transition disabled:opacity-50 underline"
                    >
                      {discardingArchive ? "設定中..." : "今回は YouTube に保存しない"}
                    </button>
                  </>
                ) : (
                  <p className="text-[11px] text-gray-400">
                    ✓ YouTube に保存しないことを記録しました
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 space-y-2">
              <button
                onClick={() => router.push("/mypage")}
                className="w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-3 rounded-md transition"
              >
                マイページに戻る
              </button>
              <button
                onClick={() => setEndedSummary(null)}
                className="w-full bg-white/10 hover:bg-white/15 text-white text-sm font-medium py-3 rounded-md transition"
              >
                もう一度配信する
              </button>
              <button
                onClick={() => router.push("/")}
                className="w-full text-xs text-gray-500 hover:text-gray-300 py-2 transition"
              >
                ホームに戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
