"use client";

import { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
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

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];

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
  const { user, profile, loading, refreshProfile } = useAuth();
  const toast = useToast();
  const subscribed = profile?.plan === "broadcaster" || profile?.plan === "team";
  const trialUsed = profile?.trial_used === true;

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
  const needsSubscription = !subscribed && trialUsed;

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

        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        // 無料ユーザーのトライアル使用を記録（サーバー側で trial_used を更新）
        if (!subscribed && accessToken) {
          fetch("/api/broadcasts/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ markTrialUsed: true }),
          }).catch(() => {});
          refreshProfile();
        }

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
          setShareCode("");
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

  // 配信終了
  async function handleEnd() {
    if (!confirm("配信を終了しますか？")) return;

    // LiveKit切断（トークンをnull化 → LiveKitRoom自動アンマウント）
    setLivekitToken(null);
    setLivekitError(null);

    if (broadcastRef.current) {
      const success = await endBroadcast(broadcastRef.current.id);
      if (!success) {
        toast.error("配信の終了に失敗しました。もう一度お試しください。");
        return;
      }
      broadcastRef.current = null;
    }
    setShareCode("");
    setHomeScore(0);
    setAwayScore(0);
    setHomeSets(0);
    setAwaySets(0);
    setSetResults([]);
    historyRef.current = [];
    setHistoryLength(0);
    setPeriodIndex(0);
  }

  // 無料お試しカウントダウンタイマー
  useEffect(() => {
    if (subscribed || !shareCode || !broadcastRef.current) {
      setTrialRemaining(null);
      return;
    }
    const startedAt = new Date(broadcastRef.current.started_at).getTime();
    const TRIAL_MS = 10 * 60 * 1000;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((startedAt + TRIAL_MS - Date.now()) / 1000));
      setTrialRemaining(remaining);
      if (remaining <= 0) {
        handleEnd();
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

    const endBroadcastSync = () => {
      const bc = broadcastRef.current;
      if (!bc || !accessToken) return;

      // keepalive: true でページ離脱時にもリクエストを完了させる
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
      broadcastRef.current = null;
    };

    // pagehide: ページが閉じられる・リロードされる時に配信を終了
    // ※ visibilitychange は使わない（通知確認や電話応答で配信が終了してしまうため）
    const handlePageHide = () => endBroadcastSync();

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

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

          <div className="mt-8 rounded-md bg-[#111] border border-white/5 p-4">
            <p className="text-[11px] text-gray-400 font-medium mb-2">配信者プラン</p>
            <p className="text-lg font-black">¥300<span className="text-xs font-normal text-gray-500">/月</span></p>
            <p className="text-[10px] text-gray-500 mt-1">初回10分間は無料でお試し</p>
            <ul className="mt-2 space-y-1 text-[10px] text-gray-500">
              <li>✓ スコアボード・オーバーレイ</li>
              <li>✓ リモコンでスコア操作</li>
              <li>✓ 限定公開の共有コード発行</li>
              <li>✓ アーカイブ自動保存</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ===== 配信中（フルスクリーン） =====
  if (screen === "live") {
    const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/watch/${shareCode}`;
    return (
      <div className="fixed inset-0 z-[60] bg-black" style={{ height: "100dvh" }}>
        <div className="relative w-full h-full bg-[#0a0a0a] overflow-hidden">
          {/* LiveKit映像レイヤー */}
          {livekitToken ? (
            <LiveKitBroadcaster
              token={livekitToken}
              serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
              onError={(e) => {
                console.error("LiveKitエラー:", e);
                if (isCameraPermissionError(e)) {
                  setShowCameraGuide(true);
                  setLivekitError(null);
                } else {
                  setLivekitError("映像配信でエラーが発生しました。ページを再読み込みしてください。");
                }
              }}
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

          {/* 左上: スコアボード・オーバーレイ */}
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

          {/* 右上: 大会名 + LIVE + お試し表示 */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-1.5">
            {!subscribed && trialRemaining !== null && (
              <div className={`backdrop-blur-sm rounded px-2 py-1 text-[9px] font-medium ${trialRemaining <= 60 ? "bg-red-500/30 text-red-400 animate-pulse" : "bg-yellow-500/20 text-yellow-500"}`}>
                残り {Math.floor(trialRemaining / 60)}:{String(trialRemaining % 60).padStart(2, "0")}
              </div>
            )}
            {(tournament || sport) && (
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
              onClick={() => copyToClipboard(shareCode, "code")}
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
            <a
              href={`https://line.me/R/share?text=${encodeURIComponent(`【試合配信中】\n${home} vs ${away}\n${tournament ? tournament + "\n" : ""}視聴はこちら → ${shareUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] rounded px-2 sm:px-3 py-1.5 transition"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z"/></svg>
              <span className="text-[10px] font-semibold">LINEで共有</span>
            </a>

            {!subscribed && (
              <a
                href="/pricing"
                className="flex items-center gap-1 bg-[#e63946] hover:bg-[#d62836] rounded px-2 sm:px-3 py-1.5 transition text-[10px] font-semibold"
              >
                プランに登録
              </a>
            )}

            <button
              onClick={handleEnd}
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

        {/* 配信ボタン */}
        <button
          disabled={!canStart || needsSubscription || starting}
          onClick={handleStart}
          className="w-full bg-[#e63946] text-white text-sm font-semibold py-3 rounded-md transition mt-2 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-[#d62836]"
        >
          {starting
            ? "配信を準備中..."
            : !subscribed && !trialUsed
              ? "配信をスタート（10分間無料お試し）"
              : "配信をスタート"}
        </button>
        {!canStart && (
          <p className="text-center text-[10px] text-[#e63946]/60">
            チーム名と対戦相手を入力してください
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
