"use client";

import { Suspense, useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
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
  updateBroadcastNotice,
  endBroadcast,
  cleanupStaleBroadcasts,
  type Broadcast,
  type Team,
} from "@/lib/database";
import { pickBroadcastResolution, detectInAppBrowser } from "@/lib/user-agent";
import type { ScoreboardState } from "@/lib/scoreboard-canvas";
import { useStageFullscreen } from "@/lib/use-stage-fullscreen";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import {
  SPORT_TENNIS,
  SPORT_SOFT_TENNIS,
  HARD_TENNIS_RULES,
  SOFT_TENNIS_RULES,
  initialTennisSnapshot,
  tennisAddPoint,
  tennisRemovePoint,
  formatTennisPoints,
  tennisPointLabel,
  type TennisRule,
  type TennisSnapshot,
} from "@/lib/tennis";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "テニス", "ソフトテニス", "陸上", "その他"];

// Android 横向きゲートの逃げ道として案内する Play ストア URL。
// ネイティブアプリ版は端末の向きを自前で扱うためこのゲート自体が存在しない。
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.linnah.livespotch";

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

/**
 * 配信終了時点で分かっている「この試合の映像が YouTube に残るか」。
 *
 * ★プラン / 連携状態から推測してはいけない。ブラウザ配信は
 *   LiveKit → YouTube Live への生中継なので、YouTube 側の起動に失敗すると
 *   （本番最多の失敗 "The user is not enabled for live streaming."）
 *   映像はどこにも残らない。/api/livekit/live/start の実結果だけが根拠になる。
 *
 * 断定してよいのは started / failed / opted-out の 3 つ。
 * unknown は「確認できなかった」であり、残る／残らないのどちらも断定しない。
 */
type YoutubeSaveOutcome =
  /** live/start が YouTube Live broadcast 作成 → bind → Egress 起動まで成功した */
  | "started"
  /** 起動できなかった（未連携 / 保存スイッチOFF / YouTube側でライブ配信が未有効 等） */
  | "failed"
  /** 起動を試みたが結果を確認できなかった（通信断など）。断定しない文言を使う */
  | "unknown"
  /** 今回は YouTube に流さない選択をした（配信前のチェックを外した） */
  | "opted-out"
  /** 保存機能自体が動いていない（フラグOFF）。終了モーダルには何も出さない */
  | "unavailable";

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

  // Android横向きゲート: Android で縦持ちのまま配信を開始すると
  // 視聴側で映像が 90° 倒れる（Android Chrome が CVO を送らない仕様）。
  // 横向きになるまでオーバーレイで案内し、なった瞬間自動解除する。
  const [isAndroid, setIsAndroid] = useState(false);
  const [isPortraitMode, setIsPortraitMode] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return;
    const android = detectInAppBrowser().platform === "android";
    setIsAndroid(android);
    if (!android) return;
    const mq = window.matchMedia("(orientation: portrait)");
    setIsPortraitMode(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsPortraitMode(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
  const [tennisRuleKey, setTennisRuleKey] = useState(HARD_TENNIS_RULES[0].key);
  const [softTennisRuleKey, setSoftTennisRuleKey] = useState(SOFT_TENNIS_RULES[0].key);
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
  // 共有ボタン押下中フラグ。true の間は配信 canvas を「URL 共有中」案内に
  // 切り替えて視聴者画面のブラックアウトを防ぐ。
  // 解除条件: visibility=visible 復帰 / 60 秒タイムアウト / 配信終了。
  const [isSharing, setIsSharing] = useState(false);
  // 共有ボタン onClick から canvas を「同期描画」するための ref。
  // setIsSharing(true) は React rerender → useEffect → 次の rAF/rVFC、という
  // 非同期パスのため、navigator.share() で Safari がバックグラウンドに遷移する
  // までに案内画面の描画が間に合わないケースがあった（5/05 PR #114 の不具合）。
  // この ref 経由で同期描画を発火することで captureStream の最後フレームを
  // 確実に「URL 共有中」画面に固定できる。
  // deadlineMs (epoch ms) を渡すと案内画面に「あと XX 秒で自動解除」を表示。
  const sharingStartRef = useRef<((deadlineMs?: number) => void) | null>(null);
  const sharingEndRef = useRef<(() => void) | null>(null);
  // 共有自動解除までの時間。LINE 共有は通常 5-15 秒で完了するので 30 秒で十分。
  // 60 秒だと体感長すぎ + 視聴者を待たせすぎという 5/06 オーナー指摘で短縮。
  const SHARING_TIMEOUT_MS = 30_000;
  const [homeSets, setHomeSets] = useState(0);
  const [awaySets, setAwaySets] = useState(0);
  const [setResults, setSetResults] = useState<{ home: number; away: number }[]>([]);
  // テニス/ソフトテニスの進行スナップショット（ポイント→ゲーム→セットはエンジンが自動判定）
  const [tennis, setTennis] = useState<TennisSnapshot>(initialTennisSnapshot());
  // 野球カウント（甲子園風 B/S/O＋走者・アプリ版と同仕様）
  // 視聴者向けお知らせテロップ（「延長タイブレーク中」等・"" = 非表示）
  const [notice, setNotice] = useState("");
  const [noticeDraft, setNoticeDraft] = useState("");
  const [showNoticePanel, setShowNoticePanel] = useState(false);
  const [balls, setBalls] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [outs, setOuts] = useState(0);
  const [runners, setRunners] = useState<{ first: boolean; second: boolean; third: boolean }>(
    { first: false, second: false, third: false },
  );
  // 配信終了後に表示するサマリモーダル用の state（次のアクションへの導線として使う）
  const [endedSummary, setEndedSummary] = useState<{
    durationSec: number;
    // 今回の配信で YouTube への保存が実際に始まったか（youtubeSaveOutcomeRef の確定値）。
    // 「チームプランか」「連携済みか」からは推測しない。
    youtubeSave: YoutubeSaveOutcome;
    // チームプラン（＝そもそも保存機能の対象）かどうか。
    // 無料 / 配信者プランには終了直後にアップグレードを迫らない（何も出さない）。
    teamPlan: boolean;
  } | null>(null);
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
  // YouTube Live のウォームアップ完了予定時刻 (epoch ms)。
  // 配信開始 → RTMP 接続 → YouTube CDN 配信開始まで 15-30 秒かかるため、
  // この時刻まで「YouTube 側準備中」表示にして共有を待つよう促す。
  const [youtubeReadyAt, setYoutubeReadyAt] = useState<number | null>(null);
  // 1 秒ごとに更新される現在時刻 (ms)。カウントダウン表示の再描画用。
  const [nowMs, setNowMs] = useState(() => Date.now());

  // youtubeReadyAt が設定されている間は 1 秒ごとに nowMs を更新してカウントダウン
  // 表示を再描画する。準備完了後はインターバルを止めて再描画コストを下げる。
  useEffect(() => {
    if (youtubeReadyAt === null) return;
    const interval = setInterval(() => {
      const next = Date.now();
      setNowMs(next);
      if (next >= youtubeReadyAt) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [youtubeReadyAt]);
  // 配信開始時に決定した「新パイプラインを使ったか」を保持する。
  // 開始時 enableYouTubeLiveSession の値で start API を分岐したのと整合する
  // stop API を呼ぶため、フォーム画面に戻ってから enableYouTubeLiveSession が
  // 変わっても影響を受けないように ref で固定する。
  const usingLivePipelineRef = useRef(false);
  // 今回の配信で「YouTube に映像が残るか」の確定状態。
  // handleStart で初期値を決め、/api/livekit/live/start のレスポンスで確定させる。
  // 終了モーダルはこの値だけを根拠に文言を出し分ける（プランや連携状態で推測しない）。
  const youtubeSaveOutcomeRef = useRef<YoutubeSaveOutcome>("unavailable");

  // 案内は「マイページを別タブで開く」導線なので、設定を済ませて戻ってきても
  // 手元の profile は古いまま＝「連携されていません／保存されません」と誤って
  // 断定してしまう。フォーム画面に戻ってきたタイミングで profile を取り直す。
  //
  // ★配信中（shareCode あり）は登録しない。配信中に余計な通信をしない。
  // ★focus と visibilitychange は復帰時に両方発火するので 3 秒間は 1 回に抑える。
  // refreshProfile は auth-provider で毎レンダー作り直されるため、依存配列に入れず
  // ref 経由で最新版を呼ぶ（依存に入れるとレンダーのたびに購読し直しになる）。
  const refreshProfileRef = useRef(refreshProfile);
  useEffect(() => {
    refreshProfileRef.current = refreshProfile;
  });
  const lastProfileRefreshRef = useRef(0);
  const isBroadcasting = shareCode !== "";
  useEffect(() => {
    if (!user?.id || isBroadcasting) return;
    const onBackToForm = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastProfileRefreshRef.current < 3000) return;
      lastProfileRefreshRef.current = now;
      void refreshProfileRef.current();
    };
    window.addEventListener("focus", onBackToForm);
    document.addEventListener("visibilitychange", onBackToForm);
    return () => {
      window.removeEventListener("focus", onBackToForm);
      document.removeEventListener("visibilitychange", onBackToForm);
    };
  }, [user?.id, isBroadcasting]);

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

  // 共有中オーバーレイの自動解除:
  // 配信者が LINE 等から Safari に戻ってきた瞬間（visibility=visible）に
  // isSharing を false にしてカメラ映像描画を再開する。
  // ref 経由の同期解除も呼んで isSharingRef.current = false を即時反映し、
  // 次の rAF で renderFrame が rVFC ルートに戻るようにする。
  useEffect(() => {
    if (!isSharing) return;
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        sharingEndRef.current?.();
        setIsSharing(false);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isSharing]);

  // 共有中オーバーレイの安全タイムアウト:
  // visibility イベントが届かない端末や、ユーザーが共有シートをキャンセル
  // した場合に永遠にオーバーレイが残らないよう SHARING_TIMEOUT_MS で強制解除する。
  // 案内画面のカウントダウンと同じ時間にする（startSharing 呼び出し側で deadline 計算）。
  useEffect(() => {
    if (!isSharing) return;
    const t = window.setTimeout(() => {
      sharingEndRef.current?.();
      setIsSharing(false);
    }, SHARING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [isSharing]);

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
    // テニス系のみ使用（他競技では直前値をそのまま保持）
    tennis: TennisSnapshot;
  };
  const historyRef = useRef<ScoreSnapshot[]>([]);
  const [historyLength, setHistoryLength] = useState(0);
  // テニス系は±がポイント単位（デュース1ゲームで10手超も普通）のため、
  // ゲームを跨いだ訂正が Undo で届くよう余裕を持たせる（全競技共通・実害なし）。
  const MAX_HISTORY = 40;

  const vbRule = sport === "バレー" ? VOLLEYBALL_RULES[volleyballRule] : null;
  const bbRule = sport === "野球" ? BASEBALL_RULES[baseballRule] : null;
  const tnRule: TennisRule | null =
    sport === SPORT_TENNIS
      ? HARD_TENNIS_RULES.find((r) => r.key === tennisRuleKey) || HARD_TENNIS_RULES[0]
      : sport === SPORT_SOFT_TENNIS
        ? SOFT_TENNIS_RULES.find((r) => r.key === softTennisRuleKey) || SOFT_TENNIS_RULES[0]
        : null;
  const periods = sport === "バレー"
    ? (vbRule?.periods || ["1SET", "2SET", "3SET"])
    : sport === "野球"
      ? (bbRule?.periods || generateBaseballPeriods(9))
      : tnRule
        ? tnRule.kind === "hard"
          ? Array.from({ length: tnRule.setsToWin * 2 - 1 }, (_, i) => `${i + 1}SET`)
          : ["GAME"]
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

  const pointLabel = tnRule ? tennisPointLabel(tnRule, tennis) : getPointLabel();
  // テニス系: ボタン間に表示するゲーム内ポイント（マッチ確定後は最終ゲーム数のまま "—"）
  const tennisDisplay = tnRule
    ? formatTennisPoints(tnRule, tennis) ?? { home: "—", away: "—" }
    : null;

  // スコアボード焼き込み（発熱対策・2026-06-08 既定 OFF 化）:
  // 既定を「焼き込みOFF（生配信）」にする。スマホは合成せずカメラ生映像を送るだけ＝
  // 発熱が下がり画質も向上する。スコアは
  //   - 自社プレイヤー: 視聴側 CSS オーバーレイ（+ iPhone フェイク全画面）
  //   - YouTube: LiveKit Cloud 側でサーバー合成（live/start の 1-D 経路）
  // で表示する。共有時の publish 断は useShareKeepalive で保護済み（生配信経路にも実装）。
  // 緊急ロールバックは `?burn=1` で焼き込みON（合成→配信）に戻せる。
  const burnParam = searchParams.get("burn");
  const burnScoreboard = burnParam === "1";
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

  // ゴースト対策の心拍: 配信中は 60 秒ごとに last_seen_at を更新する。
  // 異常終了（クラッシュ/スリープ/回線断）で停止処理(pagehide/stop)が飛ばなくても、
  // サーバー cron(/api/cron/cleanup) が last_seen の途絶を見て自動で ended に補正できる
  // （恒久対策の心臓）。失敗は次の心拍で再送するので無視する。
  useEffect(() => {
    if (!broadcastStartedAt) return;
    const supabase = createClient();
    const beat = async () => {
      const id = broadcastRef.current?.id;
      if (!id) return;
      try {
        await supabase
          .from("broadcasts")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", id);
      } catch {
        // 失敗は無視（次の心拍で再送）
      }
    };
    void beat();
    const interval = setInterval(() => void beat(), 60_000);
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
    // 緊急焼き込み(?burn=1)時もテニスのポイントが映像に出るように
    gamePoints: tnRule ? formatTennisPoints(tnRule, tennis) : null,
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
      tennis: { ...tennis, setResults: [...tennis.setResults] },
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
    setTennis(prev.tennis);
    if (tnRule) {
      saveGamePointsToDb(
        formatTennisPoints(tnRule, prev.tennis),
        tennisPointLabel(tnRule, prev.tennis),
      );
    }
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

  // 視聴者向けお知らせテロップの反映（DB 直接 UPDATE → Realtime で視聴ページに届く）。
  // text=null で非表示に戻す。
  async function applyNotice(text: string | null) {
    if (!broadcastRef.current) return;
    const trimmed = text?.trim() || null;
    const ok = await updateBroadcastNotice(broadcastRef.current.id, trimmed);
    if (ok) {
      setNotice(trimmed ?? "");
      setNoticeDraft("");
      setShowNoticePanel(false);
      toast.info(trimmed ? "視聴者にお知らせを表示しました" : "お知らせを消しました");
    } else {
      toast.error("お知らせの更新に失敗しました");
    }
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
    // 野球はイニングが変わったらカウント（B/S/O・走者）をリセット
    if (sport === "野球") resetBaseballCount();
  }

  // ── テニス系: ゲーム内ポイント（表示用文字列）と point_label を直接 UPDATE ──
  // （updateBroadcastScore は固定シグネチャのため、野球カウントと同じ別経路で書く）
  const saveGamePointsToDb = useCallback(
    (gp: { home: string; away: string; tb?: true } | null, label: string | null) => {
      if (!broadcastRef.current) return;
      const supabase = createClient();
      supabase
        .from("broadcasts")
        .update({ game_points: gp, point_label: label })
        .eq("id", broadcastRef.current.id)
        .then(undefined, () => {});
    },
    [],
  );

  // ── テニス/ソフトテニス: ＋ボタンはゲームでなく「ポイント」を進める ──
  // ゲーム/セット/マッチの確定はエンジン（lib/tennis.ts）が自動判定する。
  function tennisPoint(side: "home" | "away") {
    if (!tnRule) return;
    if (tennis.matchWon) return; // 確定後の no-op で Undo 履歴を浪費しない
    pushHistory();
    const { next, events } = tennisAddPoint(tnRule, tennis, side);
    setTennis(next);
    setHomeScore(next.hGames);
    setAwayScore(next.aGames);
    setHomeSets(next.hSets);
    setAwaySets(next.aSets);
    const sr = next.setResults.map((s) => {
      const [h, a] = s.split("-").map(Number);
      return { home: h || 0, away: a || 0 };
    });
    setSetResults(sr);
    let idx = periodIndex;
    // マッチ確定時は period を進めない（2-0完走で「3SET」表示になるオフバイワン防止）
    if (events.setWon && !events.matchWon && tnRule.kind === "hard") {
      idx = Math.max(0, Math.min(periods.length - 1, next.hSets + next.aSets));
      setPeriodIndex(idx);
    }
    saveScoreToDb(next.hGames, next.aGames, periods[idx] || periods[0], next.hSets, next.aSets, sr);
    saveGamePointsToDb(formatTennisPoints(tnRule, next), tennisPointLabel(tnRule, next));
    if (events.matchWon) toast.success("マッチ終了！おつかれさまでした");
    else if (events.setWon) toast.info("セット獲得！");
  }
  function tennisPointMinus(side: "home" | "away") {
    if (!tnRule) return;
    // 0-0 や確定後は no-op（Undo 履歴のスロットを浪費しない）
    if (tennis.matchWon) return;
    if (side === "home" ? tennis.hPts === 0 : tennis.aPts === 0) return;
    pushHistory();
    const next = tennisRemovePoint(tennis, side);
    setTennis(next);
    saveGamePointsToDb(formatTennisPoints(tnRule, next), tennisPointLabel(tnRule, next));
  }

  // ── 野球カウント（B/S/O＋走者）。アプリ版 sports.ts と同ロジック ──
  // カウントは broadcasts に直接 UPDATE（updateBroadcastScore は固定シグネチャのため別経路）。
  const saveBaseballCountToDb = useCallback(
    (b: number, s: number, o: number, r: { first: boolean; second: boolean; third: boolean }) => {
      if (!broadcastRef.current) return;
      const supabase = createClient();
      supabase
        .from("broadcasts")
        .update({ balls: b, strikes: s, outs: o, runners: r })
        .eq("id", broadcastRef.current.id)
        .then(undefined, () => {});
    },
    [],
  );
  function resetBaseballCount() {
    const empty = { first: false, second: false, third: false };
    setBalls(0);
    setStrikes(0);
    setOuts(0);
    setRunners(empty);
    saveBaseballCountToDb(0, 0, 0, empty);
  }
  function addBallW() {
    const nb = balls >= 3 ? 0 : balls + 1; // 4球目=フォアボール→B/Sリセット
    const ns = balls >= 3 ? 0 : strikes;
    setBalls(nb);
    setStrikes(ns);
    saveBaseballCountToDb(nb, ns, outs, runners);
  }
  function recordOutW() {
    const no = outs + 1;
    if (no >= 3) {
      // 3アウト＝攻守交代。次イニングへ（changePeriod が野球時にカウントもリセット）
      changePeriod(periodIndex + 1);
      return;
    }
    setBalls(0);
    setStrikes(0);
    setOuts(no);
    saveBaseballCountToDb(0, 0, no, runners);
  }
  function addStrikeW() {
    if (strikes >= 2) {
      recordOutW(); // 3ストライク＝三振→アウト
      return;
    }
    const ns = strikes + 1;
    setStrikes(ns);
    saveBaseballCountToDb(balls, ns, outs, runners);
  }
  function toggleRunnerW(base: "first" | "second" | "third") {
    const nr = { ...runners, [base]: !runners[base] };
    setRunners(nr);
    saveBaseballCountToDb(balls, strikes, outs, nr);
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
      // 念のため、自分の「まだ生きている配信」（前回が異常終了して裏に残った
      // ゴースト含む）をサーバー側で全部終了してから新規開始する。これをしないと
      // 1 台の端末が映像を 2 本同時にエンコードして発熱・シャットダウンする事故が
      // 起きる（2026-06-07 実発生）。best-effort（失敗しても続行）。
      try {
        const cleanupClient = createClient();
        const { data: cleanupSession } = await cleanupClient.auth.getSession();
        const cleanupToken = cleanupSession.session?.access_token;
        if (cleanupToken) {
          await fetch("/api/livekit/broadcast/cleanup-stale", {
            method: "POST",
            headers: { Authorization: `Bearer ${cleanupToken}` },
          });
        }
      } catch (e) {
        console.warn("古い配信の終了に失敗（続行します）:", e);
      }

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
        scoreboardBurnedIn: burnScoreboard,
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
    // Live 中継（新パイプライン）は焼き込み有無に関わらず起動する（発熱対策 Phase 1-D）:
    //   - 焼き込みON  → live/start 内で TrackComposite（焼き込み済み track 直送り）
    //   - 焼き込みOFF → live/start 内で RoomComposite + スコア合成テンプレートで YouTube へ
    // 旧アーカイブ（egress/start・録画→アップロード）は従来どおり焼き込みパスのみ対象。
    const willCallArchiveStart =
      !!archiveStartPath &&
      !!broadcastRef.current &&
      (useLivePipeline || burnScoreboard);

    // 終了モーダル用の初期値をここで確定させる。
    //   - 機能自体が動いていない → "unavailable"（終了モーダルには何も出さない）
    //   - 起動を試みる           → いったん "unknown"。Live 経路はレスポンスで
    //                              started / failed に確定させる（旧録画経路は結果が
    //                              返らないので unknown のまま＝断定しない）
    //   - 1 度も試みていない     → チェックを外したなら "opted-out"（意図どおり）、
    //                              そうでなければ "failed"（起動条件を満たさなかった）
    youtubeSaveOutcomeRef.current = !isLiveArchiveEnabled()
      ? "unavailable"
      : willCallArchiveStart
        ? "unknown"
        : enableYouTubeLiveSessionRef.current
          ? "failed"
          : "opted-out";

    if (archiveStartPath && willCallArchiveStart && broadcastRef.current) {
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
          if (useLivePipeline) {
            const data = res.ok
              ? ((await res.json().catch(() => null)) as
                  | { liveBroadcastId?: string; reused?: string; skipped?: string }
                  | null)
              : null;
            // ★終了モーダルの根拠。live/start は YouTube Live broadcast の作成 →
            //   bind → Egress 起動まで **全部成功したときだけ** liveBroadcastId を返す
            //   （再接続で 2 回叩いた場合の冪等 reuse は reused を返す＝既に起動済み）。
            //   失敗（"The user is not enabled for live streaming." 等）は 5xx、
            //   未連携 / 保存スイッチOFF は 200 + skipped で返るため、どちらも
            //   liveBroadcastId も reused も無い＝「YouTube には残らない」と確定できる。
            youtubeSaveOutcomeRef.current =
              data?.liveBroadcastId || data?.reused ? "started" : "failed";
            if (data?.liveBroadcastId) {
              setLiveYoutubeBroadcastId(data.liveBroadcastId);
              // YouTube Live は RTMP 接続 → ingest → CDN 配信開始まで 15-30 秒
              // のウォームアップ期間がある。共有ボタンに「準備中」表示を出して
              // 配信者が早すぎる共有でブラックアウト視聴体験を視聴者に与える事故を
              // 防ぐ。20 秒は YouTube Live の典型的なウォームアップ時間に
              // 安全マージンを乗せた値。
              setYoutubeReadyAt(Date.now() + 20_000);
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

    // 配信終了モーダル / 後続の cleanup 用に、経過時間と broadcastId を
    // state リセット前に取り出しておく
    const startedAtMs = broadcastStartedAt ? new Date(broadcastStartedAt).getTime() : null;
    const durationSec = startedAtMs
      ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
      : 0;
    const endedBroadcastId = broadcastRef.current?.id ?? null;
    // 旧判定は isArchiveEnabled()（本番で未設定＝false）を見ていたため、この
    // ブロックは本番で一度も表示されていなかった。さらに「プラン + 連携済み +
    // 保存スイッチON」から推測する判定も、YouTube 側の起動失敗（本番最多の
    // "The user is not enabled for live streaming."）を拾えず「保存されます」と
    // 嘘をつく。実際に起動できたか（youtubeSaveOutcomeRef）だけを根拠にする。
    // ※ どちらの ref も下の state リセットより前に読む必要がある。
    const teamPlan = profile?.plan === "team";
    const youtubeSave = youtubeSaveOutcomeRef.current;

    // 配信終了サマリモーダルを最初に表示する。
    // ここで先に出さないと、後続の await（getSession / endBroadcast 等）が
    // ネットワーク不調でハングしたときにモーダルが永遠に出ず UI が固まったように見える
    // （6 本目 E2E で再現した症状）。サーバー側 cleanup は cleanup cron が拾うので
    // クライアント awaits を投機的に走らせて握りつぶせる。
    setEndedSummary({
      durationSec,
      youtubeSave,
      teamPlan,
    });

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
    setTennis(initialTennisSnapshot());
    setBalls(0);
    setStrikes(0);
    setOuts(0);
    setRunners({ first: false, second: false, third: false });
    historyRef.current = [];
    setHistoryLength(0);
    setPeriodIndex(0);
    // 次の配信に備えて Live 中継関連 state をリセット
    setLiveYoutubeBroadcastId(null);
    setYoutubeReadyAt(null);
    usingLivePipelineRef.current = false;
    // 次の配信に持ち越すと前回の結果で誤った案内を出すため必ず戻す
    youtubeSaveOutcomeRef.current = "unavailable";

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

        // 終了時に進行中セットの得点を最終確定として set_results に記録する
        // （バレーのみ＝Web の set 制競技。オーナー要望 2026-06-13・アプリ版 finishLive と同じ思想）。
        // 「次のセットへ」を押さず終了するのが普通なので、これが無いと最後のセット得点が失われる。
        // セット数は勝利点（通常/最終セット）＋2点差を満たした時だけ加算し、未達なら
        // スコアだけ記録（途中終了でセット数が過剰加算されないように）。
        // ※ homeScore 等はリセット前の値を closure で参照している（setHomeScore(0) は当該描画の const を変えない）。
        if (
          sport === "バレー" &&
          vbRule &&
          endedBroadcastId &&
          (homeScore > 0 || awayScore > 0)
        ) {
          const finalSetResults = [...setResults, { home: homeScore, away: awayScore }];
          const isFinalSet = homeSets + awaySets >= vbRule.setsToWin * 2 - 2;
          const target = isFinalSet ? vbRule.finalSetPoint : vbRule.setPoint;
          const setWon =
            Math.max(homeScore, awayScore) >= target &&
            Math.abs(homeScore - awayScore) >= 2;
          let fHomeSets = homeSets;
          let fAwaySets = awaySets;
          if (setWon) {
            if (homeScore > awayScore) fHomeSets = homeSets + 1;
            else if (awayScore > homeScore) fAwaySets = awaySets + 1;
          }
          await updateBroadcastScore(
            endedBroadcastId,
            homeScore,
            awayScore,
            currentPeriod,
            fHomeSets,
            fAwaySets,
            finalSetResults,
          ).catch(() => {});
        }

        // テニス系: 最終スコアを常に確定書き込みし、ポイント表示は消す。
        // - マッチ完走済み(tennis.matchWon)なら set_results は確定済み＝追記しない
        //   （ソフトテニスはゲーム数が残るため、旧実装だと最終スコアが二重記録された）
        // - 進行中セットがあれば最終確定として追記（バレーと同じ思想・セット数は加算しない）
        // - 常に書くのは、直前ポイントの saveScoreToDb(500msデバウンス) が終了処理の
        //   broadcastRef クリアで破棄されても最終値が残るようにするため
        if (tnRule && endedBroadcastId) {
          const inProgress = !tennis.matchWon && (homeScore > 0 || awayScore > 0);
          const finalSetResults = inProgress
            ? [...setResults, { home: homeScore, away: awayScore }]
            : setResults;
          await updateBroadcastScore(
            endedBroadcastId,
            homeScore,
            awayScore,
            currentPeriod,
            homeSets,
            awaySets,
            finalSetResults,
          ).catch(() => {});
          const supabaseEnd = createClient();
          await supabaseEnd
            .from("broadcasts")
            .update({ game_points: null, point_label: null })
            .eq("id", endedBroadcastId)
            .then(undefined, () => {});
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

  // 【削除済み】配信終了モーダルの「今回はYouTubeに保存しない」ボタン。
  // 叩いていた /api/broadcasts/archive-decision は旧経路（録画→アップロード）用で、
  // broadcasts.youtube_upload_status を 'cancelled' にするだけ。ブラウザ配信は
  // LiveKit → YouTube Live への生中継なので、押した時点で動画は既に YouTube 上に
  // 存在しており、この API では **何も止まらない**（押しても保存され続ける）。
  // 「押したのに消えない」が最悪なので、ボタン自体を出さず、YouTube Studio から
  // 削除できることを案内する（終了モーダル C-1 を参照）。

  // 無料お試しカウントダウンタイマー（累積秒数ベース）
  useEffect(() => {
    // ★二重防御: profile が読めていない（= プランが分からない）間は、決して打ち切らない。
    //   圏外や一時的なDB障害で profile が null になると subscribed が false に落ちるため、
    //   ここで止めないと課金者の試合が10分で強制終了する。プランは「分かるまで止めない」。
    if (subscribed || !shareCode || !profile) {
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
  }, [subscribed, shareCode, profile]);

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
  // ヘッダー（ロゴ + タイトル）を即表示してページシェル感を出す。
  // 認証チェック中の空白画面で「アプリが固まった？」と感じさせない。
  if (loading) {
    return (
      <div>
        <div
          className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <div className="flex items-center justify-between">
            <Logo />
            <h1 className="text-sm font-bold text-gray-400">配信</h1>
          </div>
        </div>
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
        </div>
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
              isSharing={isSharing}
              startSharingRef={sharingStartRef}
              endSharingRef={sharingEndRef}
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
            <div
              className="absolute left-3 sm:left-4 flex flex-col items-start gap-1"
              style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
            >
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
            {/* 視聴者向けお知らせテロップの入力（📢 ボタンで開閉） */}
            {showNoticePanel && (
              <div className="mb-1.5 pb-1.5 border-b border-white/10">
                <div className="flex items-center justify-center gap-1">
                  <input
                    type="text"
                    value={noticeDraft}
                    onChange={(e) => setNoticeDraft(e.target.value)}
                    maxLength={30}
                    placeholder="自由入力（30文字まで）"
                    className="w-44 h-8 rounded bg-white/10 px-2 text-[11px] placeholder:text-gray-500 outline-none focus:bg-white/15"
                  />
                  <button
                    onClick={() => applyNotice(noticeDraft)}
                    disabled={!noticeDraft.trim()}
                    className="h-8 px-2 rounded bg-[#e63946] hover:bg-[#d62836] disabled:opacity-30 disabled:cursor-not-allowed text-[10px] font-bold transition active:scale-95"
                  >
                    表示
                  </button>
                  {notice && (
                    <button
                      onClick={() => applyNotice(null)}
                      className="h-8 px-2 rounded bg-white/10 hover:bg-white/20 text-[10px] text-gray-300 transition active:scale-95"
                    >
                      消す
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* 野球: B/S/O カウント＋走者ダイヤ（甲子園風・タップで+1／3S自動アウト・3アウト自動交代） */}
            {sport === "野球" && (
              <div className="flex items-center justify-center gap-3 mb-1.5 pb-1.5 border-b border-white/10">
                {([
                  { label: "B", val: balls, on: addBallW },
                  { label: "S", val: strikes, on: addStrikeW },
                  { label: "O", val: outs, on: recordOutW },
                ] as const).map(({ label, val, on }) => (
                  <button
                    key={label}
                    onClick={on}
                    className="flex flex-col items-center px-1.5 active:scale-90 transition"
                  >
                    <span className="text-[9px] font-bold text-gray-400">{label}</span>
                    <span className="text-base font-black tabular-nums leading-tight">{val}</span>
                  </button>
                ))}
                {/* 走者ダイヤ（二塁=上/三塁=左/一塁=右・タップで進塁/帰塁） */}
                <div className="relative" style={{ width: 24, height: 24 }}>
                  {([
                    { base: "second", style: { top: 1, left: 8 } },
                    { base: "third", style: { top: 9, left: 0 } },
                    { base: "first", style: { top: 9, left: 16 } },
                  ] as const).map(({ base, style }) => (
                    <button
                      key={base}
                      onClick={() => toggleRunnerW(base)}
                      className={runners[base] ? "absolute bg-yellow-400" : "absolute bg-white/20"}
                      style={{ width: 9, height: 9, transform: "rotate(45deg)", ...style }}
                      aria-label={`${base} runner`}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* テニス系: ゲーム数の現況（＋/−はポイントを進めるため、ゲーム数はここで見せる） */}
            {tnRule && (
              <div className="flex items-center justify-center gap-2 mb-1 text-[10px] text-gray-400">
                <span>
                  ゲーム <span className="text-white font-bold tabular-nums">{homeScore}</span>
                  <span className="mx-0.5">-</span>
                  <span className="text-white font-bold tabular-nums">{awayScore}</span>
                </span>
                {tnRule.kind === "hard" && (
                  <span>
                    セット <span className="text-white font-bold tabular-nums">{homeSets}</span>
                    <span className="mx-0.5">-</span>
                    <span className="text-white font-bold tabular-nums">{awaySets}</span>
                  </span>
                )}
                {tennis.inTiebreak && (
                  <span className="text-[#ffd166] font-bold">
                    {tnRule.kind === "soft" ? "ファイナル" : "TB"}
                  </span>
                )}
              </div>
            )}
            {/* スコア行（テニス系は＋/−がポイント操作・表示もポイント） */}
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-gray-400 max-w-[50px] truncate text-right">{home}</span>
                <button
                  onClick={() => (tnRule ? tennisPointMinus("home") : changeHomeScore(-1))}
                  className="w-10 h-10 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  −
                </button>
                <span className="text-lg font-black tabular-nums min-w-6 px-0.5 text-center">
                  {tennisDisplay ? tennisDisplay.home : homeScore}
                </span>
                <button
                  onClick={() => (tnRule ? tennisPoint("home") : changeHomeScore(1))}
                  className="w-10 h-10 rounded bg-[#e63946] hover:bg-[#d62836] flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  +
                </button>
              </div>

              <span className="text-gray-600 text-xs">-</span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => (tnRule ? tennisPointMinus("away") : changeAwayScore(-1))}
                  className="w-10 h-10 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-base font-bold transition active:scale-90"
                >
                  −
                </button>
                <span className="text-lg font-black tabular-nums min-w-6 px-0.5 text-center">
                  {tennisDisplay ? tennisDisplay.away : awayScore}
                </span>
                <button
                  onClick={() => (tnRule ? tennisPoint("away") : changeAwayScore(1))}
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
              {/* テニス系はエンジンがセット/ピリオドを自動送りするため、手動のピリオド操作と
                  「次へ 0-0」は出さない（押すと tennis スナップショットと乖離して巻き戻るため） */}
              {!tnRule && (
                <button
                  onClick={() => changePeriod(periodIndex - 1)}
                  className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm transition active:scale-90"
                  aria-label="前のピリオドへ"
                >
                  ‹
                </button>
              )}
              <span className="text-[10px] font-medium min-w-[40px] text-center">{currentPeriod}</span>
              {!tnRule && (
                <>
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
                </>
              )}
              <span className="text-gray-600 text-xs mx-0.5">|</span>
              <button
                onClick={() => setShowNoticePanel((v) => !v)}
                className={`h-8 px-2 rounded flex items-center justify-center text-sm transition active:scale-90 ${
                  notice
                    ? "bg-[#e63946]/30 text-[#ffb3bb]"
                    : "bg-white/10 hover:bg-white/20 text-gray-300"
                }`}
                aria-label="視聴者へのお知らせを設定"
                title="視聴者へのお知らせ"
              >
                📢
              </button>
            </div>
          </div>

          {/* 上部中央: 表示中のお知らせテロップ（視聴者に見えている内容の確認用） */}
          {notice && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-[2] max-w-[60%] bg-black/70 backdrop-blur-sm border border-[#e63946]/60 rounded-md px-3 py-1.5 text-[11px] text-white text-center leading-snug"
              style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
            >
              <span className="mr-1">📢</span>
              {notice}
            </div>
          )}

          {/* 右上: 全画面ボタン + 大会名 + LIVE + お試し表示 */}
          <div
            className="absolute right-3 sm:right-4 flex items-center gap-1.5"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
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
            {(() => {
              // YouTube ウォームアップ残り秒数。0 なら準備完了。
              const remainingSec = youtubeReadyAt
                ? Math.max(0, Math.ceil((youtubeReadyAt - nowMs) / 1000))
                : 0;
              const isYoutubeWarming = remainingSec > 0;
              return (
                <button
                  type="button"
                  onClick={async () => {
                    // YouTube 準備中なら確認モーダルで意識喚起。
                    // 自社プレイヤー URL は即時 OK だが、LINE 共有テキストには
                    // 両 URL が含まれるため受信者が YouTube 側を選ぶとブラックアウトを
                    // 見るリスクがある。配信者が「分かってる」場合は共有を許可する。
                    if (isYoutubeWarming) {
                      const ok = confirm(
                        `⚠️ YouTube 側がまだ準備中です（残り約 ${remainingSec} 秒）\n\n` +
                          "自社プレイヤー URL は今すぐ視聴できますが、\n" +
                          "YouTube URL は受信者が数秒〜20 秒待つ必要があります。\n\n" +
                          "それでも今共有しますか？",
                      );
                      if (!ok) return;
                    }

                    const youtubeWatchUrl = liveYoutubeBroadcastId
                      ? `https://youtu.be/${liveYoutubeBroadcastId}`
                      : null;
                    const tournamentLine = tournament ? `${tournament}\n` : "";
                    const youtubeBlock = youtubeWatchUrl
                      ? `\n\n📺 YouTube版\n${youtubeWatchUrl}`
                      : "";
                    const text = `【試合配信中】\n${home} vs ${away}\n${tournamentLine}\n📱 より高画質・リアルタイム視聴（推奨）\n${shareUrl}${youtubeBlock}`;

                    // 共有開始時点で canvas を「URL 共有中」オーバーレイに切替。
                    // LINE アプリ起動 → Safari バックグラウンド → JS 停止後も
                    // captureStream の最後のフレーム = この絵 が出続けるので
                    // 視聴者は黒画面ではなく案内メッセージを見続ける。
                    // 解除は visibility=visible 復帰 / 60 秒タイムアウトで自動。
                    //
                    // ref 経由の同期描画を最初に呼ぶ。setIsSharing(true) は
                    // React の rerender → useEffect → 次の rAF/rVFC を待つ
                    // 非同期パスで、Safari バックグラウンド遷移までに描画が
                    // 間に合わないケースがあった（5/05 不具合）。ref 経由なら
                    // この onClick の同期コンテキストで canvas に焼き込めるので
                    // navigator.share() の前に最終フレームが確定する。
                    // deadline を渡すと案内画面に「あと XX 秒で自動解除」を表示。
                    const deadlineMs = Date.now() + SHARING_TIMEOUT_MS;
                    sharingStartRef.current?.(deadlineMs);
                    setIsSharing(true);

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
                          title:
                            home && away
                              ? `${home} vs ${away}`
                              : "LIVE SPOtCH 試合配信中",
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
                  className={
                    isYoutubeWarming
                      ? "flex items-center gap-1.5 bg-amber-600/80 hover:bg-amber-600 active:bg-amber-700 rounded px-2 sm:px-3 py-1.5 transition"
                      : "flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] active:bg-[#04a043] rounded px-2 sm:px-3 py-1.5 transition"
                  }
                  aria-label={
                    isYoutubeWarming
                      ? `YouTube 側準備中（残り約 ${remainingSec} 秒）。今共有すると視聴者は数秒待つ必要があります`
                      : "配信を共有する"
                  }
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
                  </svg>
                  <span className="text-[10px] font-semibold">
                    {isYoutubeWarming
                      ? `共有 ⚠️ YouTube準備中 ${remainingSec}s`
                      : "共有"}
                  </span>
                </button>
              );
            })()}

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
      {/* Android 縦持ちゲート: 横向きになるまでオーバーレイで案内（自動解除）。
          判定は matchMedia("(orientation: portrait)") ＝「OS が画面を回したか」であり
          端末を物理的に傾けたかではない。端末の自動回転がロックされていると永久に
          portrait のままになるため、解除手順とアプリ版への逃げ道を必ず併記する
          （2026-08-03 お問い合わせ: 案内が消えず配信不能という報告を受けて追加）。 */}
      {isAndroid && isPortraitMode && (
        <div className="fixed inset-0 z-50 bg-black overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center gap-5 px-8 py-10 text-center">
            <svg className="w-16 h-16 text-[#e63946] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <path strokeLinecap="round" d="M12 18h.01" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l3 3-3 3M7 8l-3 3 3 3" />
            </svg>
            <div>
              <h2 className="text-lg font-bold text-white">横向きにしてください</h2>
              <p className="mt-2 text-sm text-gray-400 leading-relaxed">
                Androidは横向き（ランドスケープ）で配信すると<br />
                視聴者に正しい向きで映像が届きます。
              </p>
            </div>
            <p className="text-xs text-gray-600">端末を横向きにすると自動で次に進みます</p>

            {/* 逃げ道①: 自動回転ロックの解除手順 */}
            <div className="w-full max-w-xs rounded-lg border border-gray-800 bg-[#111] p-4 text-left">
              <p className="text-xs font-bold text-white">横向きにしても画面が回らない場合</p>
              <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">
                端末の「画面の自動回転」がオフになっています。
              </p>
              <ol className="mt-2.5 space-y-1.5 text-[11px] text-gray-400 leading-relaxed list-decimal list-inside">
                <li>画面の上端から下に2回スワイプ</li>
                <li>「自動回転」（機種により「縦向き固定」）をタップしてオンにする</li>
                <li>端末を横向きに持つと、この画面は自動で消えます</li>
              </ol>
            </div>

            {/* 逃げ道②: アプリ版はこのゲートが無いので案内する */}
            <div className="w-full max-w-xs rounded-lg border border-[#e63946]/30 bg-[#e63946]/5 p-4">
              <p className="text-xs font-bold text-white">アプリ版ならこの画面は出ません</p>
              <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
                Android アプリ版はこの案内なしで配信を開始できます。
                （撮影は横向きがおすすめです）
              </p>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block rounded-md bg-[#e63946] px-4 py-2.5 text-xs font-bold text-white text-center"
              >
                Google Play で開く
              </a>
            </div>
          </div>
        </div>
      )}
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
                onClick={() => { setSport(s); setPeriodIndex(0); setHomeSets(0); setAwaySets(0); setTennis(initialTennisSnapshot()); }}
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

        {/* テニス/ソフトテニス ルール選択 */}
        {tnRule && (
          <fieldset>
            <legend className="text-[11px] text-gray-400 font-medium mb-2">ルール</legend>
            <div className="flex flex-wrap gap-2">
              {(sport === SPORT_TENNIS ? HARD_TENNIS_RULES : SOFT_TENNIS_RULES).map((r) => {
                const selected =
                  sport === SPORT_TENNIS ? tennisRuleKey === r.key : softTennisRuleKey === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => {
                      if (sport === SPORT_TENNIS) setTennisRuleKey(r.key);
                      else setSoftTennisRuleKey(r.key);
                      setPeriodIndex(0);
                      setHomeSets(0);
                      setAwaySets(0);
                      setTennis(initialTennisSnapshot());
                    }}
                    className={`text-xs px-3 py-1.5 rounded-md border transition ${
                      selected
                        ? "border-[#e63946] text-[#e63946] bg-[#e63946]/10"
                        : "border-white/10 text-gray-400 hover:border-white/20"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9px] text-gray-600">
              ＋ボタンでポイントが進み、ゲーム・セットは自動で確定します
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

        {/* この配信のアーカイブ状態（案内のみ）。
            ★どの分岐でも配信開始ボタンは押せるままにする。ここでボタンを塞ぐと
              試合開始に間に合わず配信機会そのものを失うため、disabled 条件には一切触れない。
            マイページの youtube_live_enabled が機能利用許諾のマスタースイッチ、
            チェックボックスは「今回の配信で使うかどうか」の都度判断。 */}
        {!profile ? null : profile.plan === "team" ? (
          isLiveArchiveEnabled() ? (
            !profile.youtube_channel_id ? (
              /* B-1: チームプランだが YouTube 未連携 → 今回の映像は残らない */
              <div className="rounded-md bg-red-500/5 border border-red-500/20 px-3 py-3">
                <p className="text-[11px] font-semibold text-white">この配信は、終了後に残りません</p>
                <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
                  YouTubeとの連携がまだのため、今回の映像は保存されません。配信中はご覧いただけますが、終了すると見返すことができなくなります。
                </p>
                {/* 同じタブで開くと入力中の試合情報が消えるため必ず別タブ */}
                <Link
                  href="/mypage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[10px] text-[#e63946] hover:underline"
                >
                  マイページでYouTubeと連携する（1〜2分）
                </Link>
                {/* 別タブで設定して戻ると focus/visibilitychange で profile を取り直すが、
                    取得に失敗したときのために手動の逃げ道も書いておく（誤った断定を残さない）。 */}
                <p className="mt-2 text-[10px] text-gray-500 leading-relaxed">
                  このまま配信を始めていただいて問題ありません。設定を終えてこの画面に戻ると表示が切り替わります（切り替わらない場合はページを再読み込みしてください）。
                </p>
              </div>
            ) : profile.youtube_live_enabled !== true ? (
              /* B-2: 連携済みだがマイページの保存スイッチが OFF */
              <div className="rounded-md bg-red-500/5 border border-red-500/20 px-3 py-3">
                <p className="text-[11px] font-semibold text-white">この配信は、終了後に残りません</p>
                <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
                  YouTubeへの保存がOFFになっています。今回の映像は保存されず、配信の終了とともに見られなくなります。
                </p>
                <Link
                  href="/mypage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[10px] text-[#e63946] hover:underline"
                >
                  マイページでYouTubeへの保存をONにする
                </Link>
                <p className="mt-2 text-[10px] text-gray-500 leading-relaxed">
                  このまま配信を始めていただいて問題ありません。設定を終えてこの画面に戻ると表示が切り替わります（切り替わらない場合はページを再読み込みしてください）。
                </p>
              </div>
            ) : (
              /* B-3: 連携済み + スイッチ ON → 今回使うかの都度チェック */
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
                      ONにすると、あなたのYouTubeチャンネルにも同時に配信され、終了後そのまま映像が残ります（限定公開）。OFFにすると、今回の映像は保存されません。
                    </p>
                  </div>
                </label>
                {enableYouTubeLiveSession && (
                  <p className="mt-2 text-[10px] text-amber-400/90 leading-relaxed">
                    はじめてご利用の方へ — YouTube側で「ライブ配信」が使える状態になっていないと、保存されません。まだ手続きをしていない場合は、使えるようになるまで最大24時間かかります。
                    <br />
                    →{" "}
                    <a
                      href="https://www.youtube.com/features"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-amber-300"
                    >
                      いま使えるか確認する（youtube.com/features）
                    </a>
                  </p>
                )}
              </div>
            )
          ) : null
        ) : (
          /* B-4: 無料プラン / 配信者プラン。他の注意ボックスより明らかに目立たせない */
          <p className="text-[10px] text-gray-500 leading-relaxed">
            このプランではライブ配信のみで、映像は保存されません。試合を残したい方は
            <Link href="/pricing" className="text-gray-400 hover:underline">
              チームプラン（¥500/月）をご覧ください →
            </Link>
          </p>
        )}

        {/* 配信前チェックリスト（YouTube 削除リスク回避・最重要） */}
        <details className="rounded-md bg-red-500/5 border border-red-500/20 group" open>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] font-medium text-red-200 flex items-center justify-between select-none">
            <span className="flex items-center gap-2">
              <span aria-hidden="true">📺</span>
              <span>YouTube 削除リスク回避（必読）</span>
            </span>
            <span className="text-red-300/60 text-[10px] group-open:rotate-180 transition-transform" aria-hidden="true">▼</span>
          </summary>
          <div className="px-3 pb-3 text-[10px] text-gray-300 leading-relaxed space-y-2.5">
            <p className="text-red-100/90">YouTube 同時配信を ON にする場合、ガイドライン違反で動画が自動削除されないよう以下にご注意ください。</p>
            <div>
              <p className="text-red-200 font-semibold mb-1">🚨 子どもだけが映る配信は禁止（最重要）</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>13 歳未満が映る配信は「大人（保護者・コーチ・監督）が画面に同時に映る」必要があります</li>
                <li>ベンチや観客席を時々映すのも有効です</li>
              </ul>
            </div>
            <div>
              <p className="text-red-200 font-semibold mb-1">📺 他メディアの映り込みに注意</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>周囲のテレビ画面が映ると Content ID 検出で削除されます</li>
                <li>選手入場曲・BGM など著作権のある音楽も同様</li>
              </ul>
            </div>
            <div>
              <p className="text-red-200 font-semibold mb-1">⚠️ 違反が累積するとリスク</p>
              <ul className="space-y-0.5 list-disc list-inside marker:text-gray-600">
                <li>警告 1 回 → 90 日で消滅（ペナルティなし）</li>
                <li>同じ違反を繰り返すと「ストライク」となり配信制限がかかります</li>
                <li>3 回でチャンネル削除のリスクがあります</li>
              </ul>
            </div>
            <p className="text-gray-400 italic">YouTube 連携 OFF で配信すれば本リスクは発生しません（自社プレイヤーのみ視聴可能）。</p>
          </div>
        </details>

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
          {/* ★配信者は横向き（ランドスケープ）で撮影しているため、横向きの画面高
              （iPhone で 320〜430px 程度）が既定。案内を足すとモーダルが縦に伸び、
              下端の「もう一度配信する」「ホームに戻る」が画面外に出て押せなくなる。
              モーダル本体に max-height + 縦スクロールを持たせて必ず操作できるようにする。 */}
          <div
            className="bg-[#0a0a0a] rounded-2xl ring-1 ring-white/10 max-w-sm w-full p-6 shadow-2xl max-h-[85vh] overflow-y-auto overscroll-contain"
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

            {/* C-1: YouTube への保存を起動できた（live/start が成功を返した）。
                ★「保存されます」と断定しない。起動には成功したが、YouTube 側の処理が
                  残っているため、この時点で完了を保証できるのは「開始したこと」まで。 */}
            {endedSummary.youtubeSave === "started" && (
              <div className="mt-4 bg-[#e63946]/5 ring-1 ring-[#e63946]/20 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-white leading-relaxed">
                  📹 YouTubeへの保存を開始しました
                </p>
                <p className="mt-1.5 text-[11px] text-gray-300 leading-relaxed">
                  YouTube側の処理があるため、見られるようになるまで1〜2時間ほどかかることがあります。結果はマイページの配信履歴でご確認ください。
                </p>
                <p className="mt-2 text-[11px]">
                  <Link href="/mypage" className="text-[#e63946] hover:underline">
                    → マイページの配信履歴を見る
                  </Link>
                </p>
                {/* ここで「今回は保存しない」ボタンは出さない。ブラウザ配信は
                    生中継なので、この時点で動画は既に YouTube 上にあり、
                    アプリ側からは取り消せない（＝押しても消えないボタンになる）。 */}
                <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                  この試合をYouTubeに残したくない場合は、YouTube Studio から削除してください。
                </p>
                <p className="mt-1 text-[11px]">
                  <a
                    href="https://studio.youtube.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#e63946] hover:underline"
                  >
                    → YouTube Studio を開く
                  </a>
                </p>
              </div>
            )}

            {/* C-1b: 起動を試みたが結果を確認できなかった（通信断など）。
                ★残る／残らないのどちらも断定しない。
                　保存機能の対象外プランには出さない（不確かな情報で不安にさせない）。 */}
            {endedSummary.youtubeSave === "unknown" && endedSummary.teamPlan && (
              <div className="mt-4 bg-white/5 ring-1 ring-white/10 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-white leading-relaxed">
                  YouTubeに保存できたかどうか、この画面では確認できませんでした
                </p>
                <p className="mt-1.5 text-[11px] text-gray-300 leading-relaxed">
                  通信の状況などにより結果を受け取れませんでした。保存されている場合もあります。マイページの配信履歴、またはYouTube Studioでご確認ください。
                </p>
                <p className="mt-2 text-[11px]">
                  <Link href="/mypage" className="text-[#e63946] hover:underline">
                    → マイページの配信履歴を見る
                  </Link>
                </p>
                <p className="mt-1 text-[11px]">
                  <a
                    href="https://studio.youtube.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#e63946] hover:underline"
                  >
                    → YouTube Studio を開く
                  </a>
                </p>
              </div>
            )}

            {/* C-1c: 今回は保存しない選択をした（配信前のチェックを外した）。
                ★設定は正しく済んでいる人なので、連携や有効化のやり直しを指示しない。 */}
            {endedSummary.youtubeSave === "opted-out" && endedSummary.teamPlan && (
              <div className="mt-4 bg-white/5 ring-1 ring-white/10 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-white leading-relaxed">
                  今回は「YouTubeに保存しない」設定で配信しました
                </p>
                <p className="mt-1.5 text-[11px] text-gray-300 leading-relaxed">
                  ご指定のとおり、この試合の映像は保存していません。次の試合で残したい場合は、配信をはじめる前に「📺 YouTube Live で同時配信する」にチェックを入れてください。
                </p>
              </div>
            )}

            {/* C-2: 起動できなかったことが確定している（未連携／保存スイッチOFF／
                YouTube側でライブ配信が未有効 など）。実データでは 103 本中 83 本が
                スイッチ・チェックの OFF、20 本が YouTube 側の未有効化だったため、
                多い順に並べる。
                C-3: 無料 / 配信者プランには何も出さない（終了直後にアップグレードを迫らない）。 */}
            {endedSummary.youtubeSave === "failed" && endedSummary.teamPlan && (
              <div className="mt-4 bg-[#e63946]/5 ring-1 ring-[#e63946]/20 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-white leading-relaxed">
                  今回の配信は、YouTubeに保存されていません
                </p>
                <p className="mt-1.5 text-[11px] text-gray-300 leading-relaxed">
                  次の試合から残すために、以下をご確認ください。
                </p>
                <ol className="mt-1 space-y-0.5 text-[11px] text-gray-400 leading-relaxed list-decimal list-inside">
                  <li>マイページの「配信時にYouTube Liveを同時起動する」がONになっているか</li>
                  <li>マイページでYouTubeアカウントが連携されているか</li>
                  <li>YouTube側で「ライブ配信」が使える状態になっているか（初回は使えるようになるまで最大24時間）</li>
                </ol>
                <p className="mt-2 text-[11px]">
                  <Link href="/mypage" className="text-[#e63946] hover:underline">
                    → マイページを開く
                  </Link>
                </p>
                <p className="mt-1 text-[11px]">
                  <a
                    href="https://www.youtube.com/features"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#e63946] hover:underline"
                  >
                    → YouTubeの設定を確認する
                  </a>
                </p>
                <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                  すでに配信済みの映像を後から保存することはできません。次の試合からご利用ください。
                </p>
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
