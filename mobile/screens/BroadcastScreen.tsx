import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useTracks,
  isTrackReference,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import RtmpPublisherView, {
  type RtmpStatusEvent,
} from "../modules/rtmp-publisher/src/RtmpPublisherView";
import { supabase } from "../lib/supabase";
import { LIVEKIT_URL, SITE_URL } from "../config";
import {
  SPORTS,
  type SportKey,
  sportLabel,
  sportKeyFromLabel,
  periodsFor,
  isSetBased,
  advanceSet,
  setUnitLabel,
  periodLabelForSet,
  baseballPeriods,
  nextPeriodIn,
  setSportRule,
  setSportPointLabel,
  isSetWon,
  volleyballRuleLabel,
  VOLLEYBALL_RULE_NAMES,
  DEFAULT_VOLLEYBALL_RULE,
  BASEBALL_RULE_NAMES,
  DEFAULT_BASEBALL_RULE,
  type BaseballCount,
  type BaseballRunners,
  emptyBaseballCount,
  addBall,
  addStrike,
  recordOut,
  toggleRunner,
} from "../lib/sports";
import {
  createBroadcast,
  updateScore,
  endBroadcast,
  sweepGhostBroadcasts,
  startLiveStream,
  stopLiveStream,
  fetchLiveYoutubeId,
  fetchBunnyIngest,
  stopBunnyStream,
} from "../lib/broadcasts";
import {
  type Plan,
  fetchPlan,
  fetchTrialUsedSeconds,
  consumeTrial,
  FREE_TRIAL_TOTAL_SECONDS,
} from "../lib/plan";
import { type MyTeam, fetchMyTeams } from "../lib/teams";
import { fetchMyProfile } from "../lib/mypage-data";
import { useNavigation } from "@react-navigation/native";

// 配信専用ネイティブアプリ。カメラをネイティブ(ハードエンコーダ)で publish しつつ、
// 配信者がアプリ内で 競技選択・スコア・ピリオド/セット を操作 → broadcasts 行を UPDATE →
// 視聴ページ( live-spotch.com/watch/<code> )のスコアボードに Realtime で即反映される。
// 生映像のみ送る(焼き込みOFF=発熱しない)設計は維持。

type Phase = "ready" | "live";

const SHARE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateShareCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += SHARE_CHARS[Math.floor(Math.random() * SHARE_CHARS.length)];
  }
  return s;
}

// 経過秒を MM:SS / H:MM:SS に整形
function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 映像に焼き込む1行スコアボード（ネイティブ RTMP 配信時に RtmpPublisher へ渡す）。
// GPU 再合成を抑えるため経過秒（毎秒変化）は含めず、得点・セット・ピリオド・野球カウント
// （実際に変わる時だけ更新）で構成する。空文字を渡すと native 側で自動非表示。
function formatScoreboardLine(a: {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  setBased: boolean;
  homeSets: number;
  awaySets: number;
  pointLabel: string | null;
  sportKey: SportKey;
  baseball: BaseballCount | null;
}): string {
  const home = a.setBased ? `${a.homeTeam}(${a.homeSets})` : a.homeTeam;
  const away = a.setBased ? `${a.awayTeam}(${a.awaySets})` : a.awayTeam;
  let line = `${home} ${a.homeScore} - ${a.awayScore} ${away}`;
  if (a.period) line += `  ${a.period}`;
  if (a.sportKey === "baseball" && a.baseball) {
    line += `  B${a.baseball.balls} S${a.baseball.strikes} O${a.baseball.outs}`;
  }
  if (a.setBased && a.pointLabel) line += `  ${a.pointLabel}`;
  return line;
}

export function BroadcastScreen() {
  const navigation = useNavigation<any>();
  const [phase, setPhase] = useState<Phase>("ready");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // ネイティブ RTMP 配信（Bunny）の完全 URL。null の間は従来 LiveKit 経路を使う。
  const [rtmpUrl, setRtmpUrl] = useState<string | null>(null);
  // 今回の配信トランスポート（finishLive で停止先を出し分ける）。
  const transportRef = useRef<"livekit" | "rtmp" | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);

  // 試合セットアップ（配信開始前に入力）
  const [sportKey, setSportKey] = useState<SportKey>("soccer");
  const [homeTeam, setHomeTeam] = useState("ホーム");
  const [awayTeam, setAwayTeam] = useState("アウェイ");
  const [tournament, setTournament] = useState("");
  // 競技のルール種別（バレー: 小学生6人制/6人制/9人制、野球: カテゴリ別イニング）
  const [volleyballRuleName, setVolleyballRuleName] = useState(DEFAULT_VOLLEYBALL_RULE);
  const [baseballRuleName, setBaseballRuleName] = useState(DEFAULT_BASEBALL_RULE);

  // ライブ中のスコア／ピリオド（バレーは home/awayScore = 現在セットの得点）
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [period, setPeriod] = useState("前半");
  // 野球カウント（甲子園風 B/S/O＋走者・ライブ中のみ意味を持つ）
  const [baseball, setBaseball] = useState<BaseballCount>(emptyBaseballCount());
  // バレーのセット集計（home_sets / away_sets / set_results に対応）
  const [homeSets, setHomeSets] = useState(0);
  const [awaySets, setAwaySets] = useState(0);
  const [setResults, setSetResults] = useState<{ home: number; away: number }[]>([]);

  // 配信終了処理の二重実行ガード（停止ボタン と onDisconnected が両方発火しうるため）
  const endedRef = useRef(false);
  // 配信開始時刻（経過時間タイマー用）と経過秒
  const liveStartedAtRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  // 画面ロック復帰時に LiveKit 接続を“作り直す(remount)”ための状態
  const [liveKey, setLiveKey] = useState(0); // 変えると LiveKitRoom が再マウント＝再接続
  const bgAtRef = useRef(0); // バックグラウンドに入った時刻
  const remountingRef = useRef(false); // 意図的な作り直し中は onDisconnected で終了させない
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // プラン＆無料トライアル
  const [plan, setPlan] = useState<Plan>("free");
  const [trialRemainingAtStart, setTrialRemainingAtStart] = useState(0);
  // 所属チーム（配信を紐付けると /discover「配信中の試合」に出る）
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // 前回の配信時間（終了サマリー用）
  const [lastDurationSec, setLastDurationSec] = useState(0);

  // YouTube同時配信＋自動アーカイブ（チームプラン＋YouTube連携済みのとき）。
  // broadcasts.id(UUID) を live/start・live/stop のボディに使う（share_codeではない）。
  const broadcastIdRef = useRef<string | null>(null);
  const liveStartedRef = useRef(false); // live/start を初回接続で1回だけ呼ぶガード
  const youtubeRequestedRef = useRef(false); // この配信で同時配信ONを選んだか
  const [youtubeEligible, setYoutubeEligible] = useState(false); // トグル表示条件
  const [youtubeLiveOn, setYoutubeLiveOn] = useState(true); // トグル状態（既定ON）
  const [liveYoutubeId, setLiveYoutubeId] = useState<string | null>(null); // 起動成功時のYouTube video ID
  const [youtubeReadyAt, setYoutubeReadyAt] = useState(0); // ウォームアップ完了予定時刻(ms)

  const setBased = isSetBased(sportKey);
  // セット制（バレー/バド/卓球）の有効ルール。表示と終了時のセット勝利判定に使う。
  const activeSetRule = setBased ? setSportRule(sportKey, volleyballRuleName) : null;

  // finishLive から「最新の得点状態」を参照するための ref（毎レンダー更新・依存配列を膨らませない）。
  // 終了時に、未確定の最終セット得点を set_results へ記録するのに使う。
  const liveScoreRef = useRef({
    setBased,
    homeScore,
    awayScore,
    homeSets,
    awaySets,
    setResults,
    period,
    rule: activeSetRule,
  });
  liveScoreRef.current = {
    setBased,
    homeScore,
    awayScore,
    homeSets,
    awaySets,
    setResults,
    period,
    rule: activeSetRule,
  };

  // 競技＋ルール種別に応じた有効ピリオド配列（野球はカテゴリでイニング数が変わる）
  const activePeriods = useMemo(
    () => (sportKey === "baseball" ? baseballPeriods(baseballRuleName) : periodsFor(sportKey)),
    [sportKey, baseballRuleName],
  );

  // セット/マッチ(ゲーム)ポイント表示（バレー/バドミントン/卓球・ライブ中のみ意味を持つ）
  const pointLabel = (() => {
    if (!setBased || !activeSetRule) return null;
    return setSportPointLabel(sportKey, activeSetRule, homeSets, awaySets, homeScore, awayScore);
  })();

  // 配信中はタブバーを隠して全画面（戻ったら表示）
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: phase === "live" ? { display: "none" } : undefined,
    });
  }, [phase, navigation]);

  // ready 画面でプランと無料トライアル残量を取得（無料は残時間を表示・使い切りで開始不可）
  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      const [p, teams, profile] = await Promise.all([
        fetchPlan(uid),
        fetchMyTeams(uid),
        fetchMyProfile(uid),
      ]);
      if (cancelled) return;
      setPlan(p);
      setMyTeams(teams);
      // YouTube同時配信は「チームプラン＋YouTube連携済み(channel_id)＋連携ON」のときだけ。
      // youtube_refresh_token はクライアントから読めない機密列のため、連携済みの代理指標として
      // youtube_channel_id 非null を使う（連携時に同時に書かれる）。最終判定はサーバー側 live/start。
      setYoutubeEligible(
        p === "team" &&
          !!profile?.youtube_channel_id &&
          profile?.youtube_live_enabled === true,
      );
      if (p === "free") {
        const used = await fetchTrialUsedSeconds(uid);
        if (!cancelled) setTrialRemainingAtStart(Math.max(0, FREE_TRIAL_TOTAL_SECONDS - used));
      } else {
        setTrialRemainingAtStart(0);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // 競技/ルールを変えたら、最初のピリオドに合わせる（ready 画面で選択時）
  useEffect(() => {
    if (phase === "live") return;
    setPeriod(activePeriods[0]);
  }, [activePeriods, phase]);

  // ライブ中、スコア/ピリオド/セットの変更を broadcasts 行へ反映（視聴ページに Realtime で届く）
  useEffect(() => {
    if (phase !== "live" || !shareCode) return;
    const patch: Parameters<typeof updateScore>[1] = {
      home_score: homeScore,
      away_score: awayScore,
      period,
    };
    if (setBased) {
      patch.home_sets = homeSets;
      patch.away_sets = awaySets;
      patch.set_results = setResults;
    }
    updateScore(shareCode, patch);
    // セット/マッチ(ゲーム)ポイントは別更新に分離（万一 point_label 列が無くても
    // 得点更新を巻き添えで失敗させない＝過去のリグレッション再発防止）。
    // バレーだけでなくバドミントン/卓球も対象。
    if (setBased) {
      updateScore(shareCode, { point_label: pointLabel });
    }
  }, [
    phase,
    shareCode,
    homeScore,
    awayScore,
    period,
    homeSets,
    awaySets,
    setResults,
    setBased,
    sportKey,
    pointLabel,
  ]);

  // 配信中の経過時間タイマー（1秒ごと）
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    let createdCode: string | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        setMessage("セッションがありません。再ログインしてください。");
        setBusy(false);
        return;
      }

      // 無料プランで体験時間（10分）を使い切っている場合は開始させない
      if (plan === "free" && trialRemainingAtStart <= 0) {
        // iOS は購入を促す表現を出さない（Apple 3.1.1・身軽モデル）。Webへ誘導する文言も置かない。
        setMessage(
          Platform.OS === "ios"
            ? "無料体験（10分）の時間に達しました。引き続きのご利用は Web 版（live-spotch.com）でご確認ください。"
            : "無料体験（10分）は終了しています。続けるには有料プランへの登録が必要です。",
        );
        setBusy(false);
        return;
      }

      // 異常終了で残った自分のゴースト配信を先に全終了（二重配信の防止）
      await sweepGhostBroadcasts(session.user.id).catch(() => {});

      const code = generateShareCode();
      const initialPeriod = activePeriods[0];

      // スコア・セット・野球カウントを初期化
      setHomeScore(0);
      setAwayScore(0);
      setHomeSets(0);
      setAwaySets(0);
      setSetResults([]);
      setBaseball(emptyBaseballCount());
      setPeriod(initialPeriod);

      const created = await createBroadcast({
        broadcasterId: session.user.id,
        shareCode: code,
        sport: sportLabel(sportKey),
        homeTeam: homeTeam.trim() || "ホーム",
        awayTeam: awayTeam.trim() || "アウェイ",
        tournament: tournament.trim(),
        teamId: selectedTeamId,
        initialPeriod,
      });
      if (created.error) {
        setMessage("配信作成エラー: " + created.error);
        setBusy(false);
        return;
      }
      createdCode = code;
      // YouTube同時配信用に broadcasts.id(UUID) を保持。条件を満たし、かつトグルONなら起動予約。
      broadcastIdRef.current = created.id ?? null;
      liveStartedRef.current = false;
      youtubeRequestedRef.current =
        youtubeEligible && youtubeLiveOn && !!created.id;
      setLiveYoutubeId(null);
      setYoutubeReadyAt(0);

      // --- 配信トランスポート選択 ---
      // まず Bunny(ネイティブRTMP＋端末スコア焼き込み)を試す。サーバーフラグ
      // (NEXT_PUBLIC_BUNNY_LIVE) がOFF/未設定なら null が返るので、従来の LiveKit 経路へ
      // 自動フォールバックする（=本番が壊れない・サーバー側フラグ1つで全体切替）。
      const bunny = created.id ? await fetchBunnyIngest(created.id) : null;
      if (bunny) {
        transportRef.current = "rtmp";
        endedRef.current = false;
        remountingRef.current = false;
        bgAtRef.current = 0;
        liveStartedAtRef.current = Date.now();
        setElapsed(0);
        // RtmpPublisher は AVCaptureSession で自前に音声を扱うため LiveKit の
        // AudioSession は使わない（スパイクでも未使用で成立）。
        setToken(null);
        setRtmpUrl(bunny.rtmpUrl);
        setShareCode(code);
        setPhase("live");
        setBusy(false);
        return;
      }
      transportRef.current = "livekit";

      // 電波が不安定で応答が返らないとボタンが固まるため 15 秒でタイムアウト
      const ctrl = new AbortController();
      let timedOut = false; // abort 理由を明示（e.name 判定に依存しない）
      const timeoutId = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, 15_000);
      let res: Response;
      try {
        res = await fetch(SITE_URL + "/api/livekit/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token,
          },
          body: JSON.stringify({
            roomName: code,
            participantIdentity: session.user.id,
            participantName: "配信者(アプリ)",
            role: "broadcaster",
          }),
          signal: ctrl.signal,
        });
      } catch {
        setMessage(
          timedOut
            ? "サーバーの応答がありません。電波の良い場所で再度お試しください。"
            : "通信に失敗しました。電波状況をご確認ください。",
        );
        await endBroadcast(createdCode).catch(() => {});
        setBusy(false);
        return;
      } finally {
        clearTimeout(timeoutId);
      }
      // サーバー側が落ちている等で JSON 以外（Vercel の 402/503 プレーンテキスト等）が
      // 返ると res.json() が "JSON Parse error" で落ちるため、安全にパースして
      // 利用者にはわかりやすい日本語を出す。
      let json: { token?: string; error?: string } | null = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok || !json?.token) {
        const maintenance = res.status === 402 || res.status === 503 || json === null;
        setMessage(
          maintenance
            ? "ただいまサーバーに接続できません（メンテナンス中の可能性）。少し時間をおいて再度お試しください。"
            : "トークン取得エラー: " + (json?.error ?? "HTTP " + res.status),
        );
        await endBroadcast(createdCode).catch(() => {});
        setBusy(false);
        return;
      }

      await AudioSession.startAudioSession();
      endedRef.current = false;
      remountingRef.current = false;
      bgAtRef.current = 0;
      liveStartedAtRef.current = Date.now();
      setElapsed(0);
      setToken(json.token);
      setShareCode(code);
      setPhase("live");
    } catch (e) {
      setMessage("開始エラー: " + (e instanceof Error ? e.message : String(e)));
      await AudioSession.stopAudioSession().catch(() => {});
      if (createdCode) await endBroadcast(createdCode).catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [
    activePeriods,
    sportKey,
    homeTeam,
    awayTeam,
    tournament,
    plan,
    trialRemainingAtStart,
    selectedTeamId,
    youtubeEligible,
    youtubeLiveOn,
  ]);

  // 配信終了（停止ボタン / 接続エラー / 切断 のいずれからも呼ばれる。二重実行は endedRef でガード）
  const finishLive = useCallback(
    async (msg: string | null) => {
      if (endedRef.current) return;
      endedRef.current = true;
      remountingRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      await AudioSession.stopAudioSession().catch(() => {});
      // 終了時に「現時点の得点」を最終確定として記録する（全競技・オーナー要望 2026-06-13）。
      const ls = liveScoreRef.current;
      if (shareCode) {
        if (ls.setBased) {
          // セット制（バレー/バドミントン/卓球）: 最終セットは「次のセットへ」を押さず終了するのが
          // 普通で、そのままだと最後のセット得点が set_results に記録されない。現在のセット得点を
          // 確定して内訳に追記する。セット数は勝利点（通常/最終セット）＋2点差を満たした時だけ加算
          // （途中終了で未達なら据え置き＝過剰加算を防止。Web版 handleEnd と同じ思想）。
          if (ls.homeScore > 0 || ls.awayScore > 0) {
            const finalSetResults = [
              ...ls.setResults,
              { home: ls.homeScore, away: ls.awayScore },
            ];
            let fHomeSets = ls.homeSets;
            let fAwaySets = ls.awaySets;
            if (
              ls.rule &&
              isSetWon(ls.rule, ls.homeSets, ls.awaySets, ls.homeScore, ls.awayScore)
            ) {
              if (ls.homeScore > ls.awayScore) fHomeSets = ls.homeSets + 1;
              else if (ls.awayScore > ls.homeScore) fAwaySets = ls.awaySets + 1;
            }
            await updateScore(shareCode, {
              home_sets: fHomeSets,
              away_sets: fAwaySets,
              set_results: finalSetResults,
            }).catch(() => {});
          }
        } else {
          // 非セット制（サッカー/バスケ/野球等）: 直前のライブ更新が電波で失敗していても
          // 最終スコアが残るよう、終了時に現在の得点・ピリオドを書き直す。
          await updateScore(shareCode, {
            home_score: ls.homeScore,
            away_score: ls.awayScore,
            period: ls.period,
          }).catch(() => {});
        }
      }
      if (shareCode) await endBroadcast(shareCode).catch(() => {});
      // 配信トランスポートを停止（全終了経路を通る finishLive に集約・await しない）。
      // - RTMP(Bunny): Bunny LiveStream を停止（停止し損ねても cron が回収）。
      // - LiveKit: YouTube同時配信の Egress を停止（→enableAutoStopでアーカイブ化）。
      if (broadcastIdRef.current) {
        if (transportRef.current === "rtmp") {
          void stopBunnyStream(broadcastIdRef.current).catch(() => {});
        } else if (transportRef.current === "livekit") {
          void stopLiveStream(broadcastIdRef.current).catch(() => {});
        }
      }
      liveStartedRef.current = false;
      setLiveYoutubeId(null);
      setYoutubeReadyAt(0);
      // 配信終了サマリー用に配信時間を記録
      if (liveStartedAtRef.current) {
        setLastDurationSec(
          Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000)),
        );
      }
      // 無料プラン: 今回消費したトライアル秒をサーバーに加算
      if (plan === "free" && liveStartedAtRef.current) {
        const used = Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000));
        if (used > 0) {
          const { data } = await supabase.auth.getSession();
          const tok = data.session?.access_token;
          if (tok) await consumeTrial(tok, used).catch(() => {});
        }
      }
      setToken(null);
      setRtmpUrl(null);
      transportRef.current = null;
      setShareCode(null);
      if (msg) setMessage(msg);
      setPhase("ready");
    },
    [shareCode, plan],
  );

  // 画面ロック/バックグラウンド対応（同じ配信を続ける＝視聴URL不変）:
  // ・背景化した時刻を記録（共有シートは "inactive" なので発火しない）。
  // ・復帰("active")時に 90秒以内なら LiveKit 接続を“作り直して(remount)”再開。
  //   → setLiveKey で LiveKitRoom を再マウント＝サーバーへ確実に再 publish。
  //   → 作り直し中は remountingRef で onDisconnected を抑止（誤終了防止）。
  // ・90秒超の離脱、または 15秒以内に onConnected が来なければ終了（視聴者を宙ぶらりんにしない）。
  useEffect(() => {
    if (phase !== "live") return;
    const GRACE_MS = 90_000;
    const RECONNECT_TIMEOUT_MS = 15_000;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        bgAtRef.current = Date.now();
      } else if (state === "active") {
        if (bgAtRef.current === 0) return;
        const awayMs = Date.now() - bgAtRef.current;
        bgAtRef.current = 0;
        if (awayMs > GRACE_MS) {
          finishLive(
            "長時間の離脱で配信を終了しました。再開するには「配信開始」を押してください。",
          );
          return;
        }
        // 接続を作り直して同じ配信を再開（視聴URLは変わらない）
        remountingRef.current = true;
        setLiveKey((k) => k + 1);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (remountingRef.current) {
            remountingRef.current = false;
            finishLive(
              "再接続できなかったため配信を終了しました。再開するには「配信開始」を押してください。",
            );
          }
        }, RECONNECT_TIMEOUT_MS);
      }
    });
    return () => sub.remove();
  }, [phase, finishLive]);

  // 無料トライアル: 残り時間が 0 になったら自動終了（1秒ごとの elapsed 変化で判定）
  useEffect(() => {
    if (phase !== "live" || plan !== "free") return;
    if (trialRemainingAtStart - elapsed <= 0) {
      finishLive(
        Platform.OS === "ios"
          ? "無料体験の時間（10分）が終了しました。引き続きのご利用は Web 版（live-spotch.com）でご確認ください。"
          : "無料体験の時間（10分）が終了しました。続けるには有料プランへ。",
      );
    }
  }, [phase, plan, trialRemainingAtStart, elapsed, finishLive]);

  // YouTube ID 読み戻し: live/start の応答が電波で届かなくても、サーバーがDBに書く
  // live_youtube_broadcast_id をポーリングして取得し、共有リンク/表示を確実に出す。
  useEffect(() => {
    if (phase !== "live") return;
    if (!youtubeRequestedRef.current) return;
    if (liveYoutubeId) return; // 既に取得済み（応答 or 前回ポーリング）
    const bid = broadcastIdRef.current;
    if (!bid) return;
    let cancelled = false;
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      if (tries > 20) {
        clearInterval(id);
        return;
      } // 最大 ~60 秒
      const ytId = await fetchLiveYoutubeId(bid).catch(() => null);
      if (cancelled) return;
      if (ytId) {
        clearInterval(id);
        setLiveYoutubeId(ytId);
        setYoutubeReadyAt((prev) => prev || Date.now() + 15000);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, liveYoutubeId]);

  // セット/ゲーム制(バレー/バドミントン/卓球): 「次へ」= 現得点を集計→セット数加算→0-0リセット→次の番号へ
  const handleNextSet = useCallback(() => {
    const r = advanceSet({ homeSets, awaySets, setResults }, homeScore, awayScore);
    setHomeSets(r.state.homeSets);
    setAwaySets(r.state.awaySets);
    setSetResults(r.state.setResults);
    setHomeScore(r.nextScore.home);
    setAwayScore(r.nextScore.away);
    const gameNumber = r.state.homeSets + r.state.awaySets + 1;
    setPeriod(periodLabelForSet(sportKey, gameNumber));
  }, [homeSets, awaySets, setResults, homeScore, awayScore, sportKey]);

  // 野球カウント操作（B/S/O＋走者）。3アウト時はイニング(period)を自動で前進。
  const advanceInning = useCallback(() => {
    setPeriod((p) => nextPeriodIn(activePeriods, p));
  }, [activePeriods]);
  const onBall = useCallback(() => setBaseball((c) => addBall(c)), []);
  const onStrike = useCallback(() => {
    const { count, thirdOut } = addStrike(baseball);
    setBaseball(count);
    if (thirdOut) advanceInning();
  }, [baseball, advanceInning]);
  const onOut = useCallback(() => {
    const { count, thirdOut } = recordOut(baseball);
    setBaseball(count);
    if (thirdOut) advanceInning();
  }, [baseball, advanceInning]);
  const onRunner = useCallback(
    (base: keyof BaseballRunners) => setBaseball((c) => toggleRunner(c, base)),
    [],
  );

  // 野球カウントをライブで broadcasts へ反映（視聴者スコアボードに即時）。
  useEffect(() => {
    if (phase !== "live" || sportKey !== "baseball" || !shareCode) return;
    updateScore(shareCode, {
      balls: baseball.balls,
      strikes: baseball.strikes,
      outs: baseball.outs,
      runners: baseball.runners,
    });
  }, [phase, sportKey, shareCode, baseball]);

  // 焼き込む1行スコアボード（RTMP配信時のみ使用・実際に変わった時だけ再合成）。
  const scoreboardLine = useMemo(
    () =>
      formatScoreboardLine({
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        period,
        setBased,
        homeSets,
        awaySets,
        pointLabel,
        sportKey,
        baseball: sportKey === "baseball" ? baseball : null,
      }),
    [
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      period,
      setBased,
      homeSets,
      awaySets,
      pointLabel,
      sportKey,
      baseball,
    ],
  );

  // ネイティブ RTMP の状態通知。LiveKit の onConnected/onError/onDisconnected と対応。
  // ※ Bunny 経路では YouTube は「試合後アーカイブ」（T10）なので、ここで startLiveStream は呼ばない。
  const handleRtmpStatus = useCallback(
    (e: RtmpStatusEvent) => {
      const state = e.nativeEvent.state;
      if (state === "open") {
        // 接続（作り直し含む）成功 → 終了タイマー解除
        remountingRef.current = false;
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      } else if (state === "error") {
        if (remountingRef.current) return; // 作り直し中の一時エラーは無視
        finishLive("配信エラー: " + (e.nativeEvent.message ?? "接続に失敗しました"));
      } else if (state === "closed") {
        if (remountingRef.current) return; // 既に作り直し中
        if (endedRef.current) return; // 停止ボタン等で終了処理中の切断は無視
        // 予期しない切断 → すぐ終了せず接続を作り直して同じ配信を再開（視聴URL不変）。
        remountingRef.current = true;
        setLiveKey((k) => k + 1);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (remountingRef.current) {
            remountingRef.current = false;
            finishLive(
              "再接続できなかったため配信を終了しました。再開するには「配信開始」を押してください。",
            );
          }
        }, 20000);
      }
    },
    [finishLive],
  );

  if (phase === "live" && rtmpUrl) {
    return (
      <RtmpLiveView
        key={liveKey}
        rtmpUrl={rtmpUrl}
        scoreboardText={scoreboardLine}
        onStatus={handleRtmpStatus}
        shareCode={shareCode}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homeScore={homeScore}
        awayScore={awayScore}
        period={period}
        setBased={setBased}
        unitLabel={setUnitLabel(sportKey)}
        pointLabel={pointLabel}
        elapsed={elapsed}
        trialRemaining={plan === "free" ? Math.max(0, trialRemainingAtStart - elapsed) : null}
        homeSets={homeSets}
        awaySets={awaySets}
        onHome={(d) => setHomeScore((s) => Math.max(0, s + d))}
        onAway={(d) => setAwayScore((s) => Math.max(0, s + d))}
        onPeriod={() => {
          setPeriod((p) => nextPeriodIn(activePeriods, p));
          if (sportKey === "baseball") setBaseball(emptyBaseballCount());
        }}
        onNextSet={handleNextSet}
        onStop={() => finishLive(null)}
        youtubeShareUrl={null}
        youtubeReadyAt={0}
        scoreSteps={sportKey === "basketball" ? [1, 2, 3] : [1]}
        baseballCount={sportKey === "baseball" ? baseball : null}
        onBall={onBall}
        onStrike={onStrike}
        onOut={onOut}
        onRunner={onRunner}
      />
    );
  }

  if (phase === "live" && token) {
    return (
      <LiveKitRoom
        key={liveKey}
        serverUrl={LIVEKIT_URL}
        token={token}
        connect={true}
        audio={true}
        video={{ facingMode: "environment" }}
        onConnected={() => {
          // 再接続（作り直し）成功 → 終了タイマー解除
          remountingRef.current = false;
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          // YouTube同時配信を起動（初回接続のみ・publish確立後）。fire-and-forget。
          // remount=背景復帰の作り直しでは liveStartedRef が true のため呼ばない（live_egress_idで冪等だが二重防止）。
          if (
            youtubeRequestedRef.current &&
            !liveStartedRef.current &&
            broadcastIdRef.current
          ) {
            liveStartedRef.current = true;
            startLiveStream(broadcastIdRef.current)
              .then((r) => {
                if (r.liveBroadcastId) {
                  setLiveYoutubeId(r.liveBroadcastId);
                  // YouTube は RTMP→CDN まで約15-30秒のウォームアップ。早すぎる共有を防ぐ。
                  setYoutubeReadyAt(Date.now() + 20000);
                }
              })
              .catch(() => {});
          }
        }}
        onError={(e) => {
          if (remountingRef.current) return; // 作り直し中の一時エラーは無視
          finishLive("配信エラー: " + (e?.message ?? "接続に失敗しました"));
        }}
        onDisconnected={() => {
          if (remountingRef.current) return; // 既に作り直し中
          if (endedRef.current) return; // 停止ボタン等で終了処理中の切断は無視
          // WiFi↔5G切替や瞬断での切断 → すぐ終了せず接続を作り直して同じ配信を再開（視聴URL不変）。
          // 20秒以内に onConnected が来なければ終了（視聴者を宙ぶらりんにしない）。
          remountingRef.current = true;
          setLiveKey((k) => k + 1);
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            if (remountingRef.current) {
              remountingRef.current = false;
              finishLive(
                "再接続できなかったため配信を終了しました。再開するには「配信開始」を押してください。",
              );
            }
          }, 20000);
        }}
      >
        <LiveView
          shareCode={shareCode}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeScore={homeScore}
          awayScore={awayScore}
          period={period}
          setBased={setBased}
          unitLabel={setUnitLabel(sportKey)}
          pointLabel={pointLabel}
          elapsed={elapsed}
          trialRemaining={plan === "free" ? Math.max(0, trialRemainingAtStart - elapsed) : null}
          homeSets={homeSets}
          awaySets={awaySets}
          onHome={(d) => setHomeScore((s) => Math.max(0, s + d))}
          onAway={(d) => setAwayScore((s) => Math.max(0, s + d))}
          onPeriod={() => {
            setPeriod((p) => nextPeriodIn(activePeriods, p));
            // 野球はイニング手動変更でカウントもリセット
            if (sportKey === "baseball") setBaseball(emptyBaseballCount());
          }}
          onNextSet={handleNextSet}
          onStop={() => finishLive(null)}
          youtubeShareUrl={liveYoutubeId ? `https://youtu.be/${liveYoutubeId}` : null}
          youtubeReadyAt={youtubeReadyAt}
          scoreSteps={sportKey === "basketball" ? [1, 2, 3] : [1]}
          baseballCount={sportKey === "baseball" ? baseball : null}
          onBall={onBall}
          onStrike={onStrike}
          onOut={onOut}
          onRunner={onRunner}
        />
      </LiveKitRoom>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>LIVE SPOtCH 配信</Text>

        <View style={styles.form}>
            <Text style={styles.ready}>試合の情報を入れて配信を開始します。</Text>
            {lastDurationSec > 0 && (
              <Text style={styles.summaryText}>
                ✅ 前回の配信時間: {formatElapsed(lastDurationSec)}
              </Text>
            )}

            {myTeams.length > 0 && (
              <>
                <Text style={styles.label}>配信するチーム</Text>
                <View style={styles.sportRow}>
                  <Pressable
                    style={[styles.sportChip, selectedTeamId === null && styles.sportChipActive]}
                    onPress={() => setSelectedTeamId(null)}
                  >
                    <Text
                      style={[
                        styles.sportChipText,
                        selectedTeamId === null && styles.sportChipTextActive,
                      ]}
                    >
                      個人配信
                    </Text>
                  </Pressable>
                  {myTeams.map((t) => {
                    const active = t.id === selectedTeamId;
                    return (
                      <Pressable
                        key={t.id}
                        style={[styles.sportChip, active && styles.sportChipActive]}
                        onPress={() => {
                          setSelectedTeamId(t.id);
                          setHomeTeam(t.name);
                          setSportKey(sportKeyFromLabel(t.sport));
                        }}
                      >
                        <Text
                          style={[styles.sportChipText, active && styles.sportChipTextActive]}
                        >
                          {t.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {selectedTeamId !== null && (
                  <Text style={styles.ruleHint}>
                    このチームの配信として「配信中の試合」に表示されます
                  </Text>
                )}
              </>
            )}

            {/* YouTube同時配信トグル（チームプラン＋YouTube連携済みのときだけ表示） */}
            {youtubeEligible && (
              <>
                <Text style={styles.label}>YouTube同時配信</Text>
                <Pressable
                  style={[styles.ytToggle, youtubeLiveOn && styles.ytToggleOn]}
                  onPress={() => setYoutubeLiveOn((v) => !v)}
                >
                  <Text
                    style={[
                      styles.ytToggleText,
                      youtubeLiveOn && styles.ytToggleTextOn,
                    ]}
                  >
                    {youtubeLiveOn
                      ? "📺 ON — YouTubeにも同時配信＋自動アーカイブ"
                      : "OFF — 自社プレイヤーのみ"}
                  </Text>
                </Pressable>
                <Text style={styles.ruleHint}>
                  連携済みのYouTubeチャンネルに限定公開でライブ配信され、終了後はそのままアーカイブとして残ります。
                </Text>
              </>
            )}

            <Text style={styles.label}>競技</Text>
            <View style={styles.sportRow}>
              {SPORTS.map((s) => {
                const active = s.key === sportKey;
                return (
                  <Pressable
                    key={s.key}
                    style={[styles.sportChip, active && styles.sportChipActive]}
                    onPress={() => setSportKey(s.key)}
                  >
                    <Text style={[styles.sportChipText, active && styles.sportChipTextActive]}>
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {sportKey === "volleyball" && (
              <>
                <Text style={styles.label}>バレーのルール</Text>
                <View style={styles.sportRow}>
                  {VOLLEYBALL_RULE_NAMES.map((name) => {
                    const active = name === volleyballRuleName;
                    return (
                      <Pressable
                        key={name}
                        style={[styles.sportChip, active && styles.sportChipActive]}
                        onPress={() => setVolleyballRuleName(name)}
                      >
                        <Text style={[styles.sportChipText, active && styles.sportChipTextActive]}>
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.ruleHint}>{volleyballRuleLabel(volleyballRuleName)}</Text>
              </>
            )}

            {sportKey === "baseball" && (
              <>
                <Text style={styles.label}>野球のカテゴリ</Text>
                <View style={styles.sportRow}>
                  {BASEBALL_RULE_NAMES.map((name) => {
                    const active = name === baseballRuleName;
                    return (
                      <Pressable
                        key={name}
                        style={[styles.sportChip, active && styles.sportChipActive]}
                        onPress={() => setBaseballRuleName(name)}
                      >
                        <Text style={[styles.sportChipText, active && styles.sportChipTextActive]}>
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.label}>ホームチーム</Text>
            <TextInput
              style={styles.input}
              value={homeTeam}
              onChangeText={setHomeTeam}
              placeholder="ホームチーム"
              placeholderTextColor="#666"
            />
            <Text style={styles.label}>アウェイチーム</Text>
            <TextInput
              style={styles.input}
              value={awayTeam}
              onChangeText={setAwayTeam}
              placeholder="アウェイチーム"
              placeholderTextColor="#666"
            />
            <Text style={styles.label}>大会名（任意）</Text>
            <TextInput
              style={styles.input}
              value={tournament}
              onChangeText={setTournament}
              placeholder="〇〇カップ など"
              placeholderTextColor="#666"
            />

            <Pressable style={styles.button} onPress={handleStart} disabled={busy}>
              <Text style={styles.buttonText}>{busy ? "準備中..." : "配信開始"}</Text>
            </Pressable>
          </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// 視聴者からのライブ応援スタンプ（❤️/👍）を配信者画面に浮かべる。
// Web 視聴ページ（live-reactions.tsx）と同一の reactions-${shareCode} チャンネルを
// 購読し、受信のたびにふわっと上昇するアニメを表示する（配信者が応援を体感できる）。
type FloatingReaction = {
  id: number;
  emoji: string;
  left: number; // 出現位置（左から%）
  drift: number; // 上昇しながらの横ドリフト(px)
  size: number;
  anim: Animated.Value;
};

function BroadcastReactions({ shareCode }: { shareCode: string }) {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const idRef = useRef(0);

  const spawn = useCallback((emoji: string) => {
    const id = idRef.current++;
    const anim = new Animated.Value(0);
    const item: FloatingReaction = {
      id,
      emoji,
      left: 6 + Math.random() * 62, // 6〜68%
      drift: Math.random() * 60 - 30, // -30〜30px
      size: 26 + Math.random() * 14, // 26〜40px
      anim,
    };
    // 同時表示は最大30個でキャップ（連打/大量受信時のパフォーマンス保護）
    setItems((prev) => (prev.length >= 30 ? prev.slice(1) : prev).concat(item));
    Animated.timing(anim, {
      toValue: 1,
      duration: 2400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    });
  }, []);

  useEffect(() => {
    if (!shareCode) return;
    const channel = supabase.channel(`reactions-${shareCode}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "react" }, ({ payload }) => {
        const kind = (payload as { kind?: string })?.kind;
        if (kind === "heart") spawn("❤️");
        else if (kind === "clap") spawn("👍");
      })
      .subscribe();
    return () => {
      channel.unsubscribe().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, [shareCode, spawn]);

  return (
    <View style={styles.reactionLayer} pointerEvents="none">
      {items.map((it) => {
        const translateY = it.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -240],
        });
        const translateX = it.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, it.drift],
        });
        const opacity = it.anim.interpolate({
          inputRange: [0, 0.15, 0.8, 1],
          outputRange: [0, 1, 1, 0],
        });
        const scale = it.anim.interpolate({
          inputRange: [0, 0.15, 1],
          outputRange: [0.6, 1, 1],
        });
        return (
          <Animated.Text
            key={it.id}
            style={[
              styles.reactionEmoji,
              {
                left: `${it.left}%`,
                fontSize: it.size,
                opacity,
                transform: [{ translateY }, { translateX }, { scale }],
              },
            ]}
          >
            {it.emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
}

type ScoreControlsProps = {
  shareCode: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  setBased: boolean;
  unitLabel: string;
  pointLabel: string | null;
  elapsed: number;
  trialRemaining: number | null;
  homeSets: number;
  awaySets: number;
  onHome: (d: number) => void;
  onAway: (d: number) => void;
  onPeriod: () => void;
  onNextSet: () => void;
  onStop: () => void;
  youtubeShareUrl: string | null; // YouTube同時配信が起動していれば https://youtu.be/<id>
  youtubeReadyAt: number; // ウォームアップ完了予定時刻(ms)。これを過ぎるまでYouTubeリンクは共有しない
  scoreSteps: number[]; // 得点ボタンの加点ステップ（通常[1]・バスケ[1,2,3]・野球[1,2,3,4]）
  baseballCount: BaseballCount | null; // 野球のときのみ B/S/O＋走者
  onBall: () => void;
  onStrike: () => void;
  onOut: () => void;
  onRunner: (base: keyof BaseballRunners) => void;
};

// 配信中オーバーレイ（スコアボードプレビュー＋スコア操作＋停止＋応援スタンプ）。
// カメラ層は持たず、LiveKit(LiveView) と ネイティブRTMP(RtmpLiveView) の両方から重ねて使う共通UI。
function ScoreControls(props: ScoreControlsProps) {
  const {
    shareCode,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    period,
    setBased,
    unitLabel,
    pointLabel,
    elapsed,
    trialRemaining,
    homeSets,
    awaySets,
    onHome,
    onAway,
    onPeriod,
    onNextSet,
    onStop,
    youtubeShareUrl,
    youtubeReadyAt,
    scoreSteps,
    baseballCount,
    onBall,
    onStrike,
    onOut,
    onRunner,
  } = props;

  // YouTube が準備中（ウォームアップ中）かどうかを1秒ごとに判定。
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!youtubeShareUrl) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => clearInterval(id);
  }, [youtubeShareUrl]);
  const youtubeWarming = !!youtubeShareUrl && now < youtubeReadyAt;

  const watchUrl = `${SITE_URL}/watch/${shareCode ?? ""}`;
  const share = useCallback(async () => {
    try {
      // YouTube同時配信が起動していれば YouTube リンクを併記する。
      // YouTube は「配信後そのままアーカイブとして残る」ため、視聴者が後から開いても見られる
      // ＝見逃しゼロのリンクとして案内する（オーナー要望 2026-06-13）。
      // url と message 両方に URL を入れると iOS で URL が二重になるため message のみ。
      let message = `試合をライブ配信中！\n${watchUrl}`;
      if (youtubeShareUrl) {
        message += `\n\n📺 YouTubeでの視聴はこちら（配信後のアーカイブもこちらで確認できます）\n${youtubeShareUrl}`;
      }
      await Share.share({ message });
    } catch {
      // 共有シートを閉じただけ等は無視
    }
  }, [watchUrl, youtubeShareUrl]);

  const confirmStop = useCallback(() => {
    Alert.alert("配信を停止しますか？", "視聴者に配信が終了します。", [
      { text: "キャンセル", style: "cancel" },
      { text: "停止する", style: "destructive", onPress: onStop },
    ]);
  }, [onStop]);

  // 縦持ち時だけ操作UI（特にアウェイ側）が画面外に切れないよう詰める。横持ちは現状維持。
  const { width: winW, height: winH } = useWindowDimensions();
  const isPortrait = winH >= winW;

  return (
    <>
      {/* 上: 視聴者に見えているのと同じスコアボードのプレビュー ＋ 停止 */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topLeftGroup}>
          <View style={styles.scorePreview}>
            <Text style={[styles.previewTeam, isPortrait && styles.previewTeamPortrait]} numberOfLines={1}>
              {homeTeam}
            </Text>
            {setBased && <Text style={styles.previewSets}>{homeSets}</Text>}
            <Text style={styles.previewScore}>
              {homeScore} - {awayScore}
            </Text>
            {setBased && <Text style={styles.previewSets}>{awaySets}</Text>}
            <Text style={[styles.previewTeam, isPortrait && styles.previewTeamPortrait]} numberOfLines={1}>
              {awayTeam}
            </Text>
            <Text style={styles.previewPeriod}>{period}</Text>
          </View>
          {pointLabel ? (
            <View
              style={[
                styles.pointBadge,
                pointLabel === "マッチポイント" && styles.pointBadgeMatch,
              ]}
            >
              <Text style={styles.pointBadgeText}>{pointLabel}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.topRightGroup}>
          {youtubeShareUrl ? (
            <Text
              style={[
                styles.elapsedText,
                styles.youtubeStatus,
                isPortrait && styles.youtubeStatusPortrait,
              ]}
            >
              {isPortrait
                ? youtubeWarming
                  ? "📺…"
                  : "📺"
                : youtubeWarming
                  ? "📺 YouTube準備中…"
                  : "📺 YouTube同時配信中"}
            </Text>
          ) : null}
          {trialRemaining !== null && (
            <Text
              style={[
                styles.elapsedText,
                trialRemaining < 60 && styles.trialWarn,
                isPortrait && styles.elapsedTextPortrait,
              ]}
            >
              {isPortrait ? "残り " : "無料体験 残り "}
              {formatElapsed(trialRemaining)}
            </Text>
          )}
          <Text style={[styles.elapsedText, isPortrait && styles.elapsedTextPortrait]}>
            ⏱ {formatElapsed(elapsed)}
          </Text>
          <Pressable
            style={[styles.stopButton, isPortrait && styles.stopButtonPortrait]}
            onPress={confirmStop}
          >
            <Text style={[styles.stopText, isPortrait && styles.stopTextPortrait]}>
              ■ 停止
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* 野球: B/S/O カウント＋走者ダイヤ（甲子園TV中継風・下部スコア操作の上に配置） */}
      {baseballCount ? (
        <View style={styles.baseballPanel} pointerEvents="box-none">
          <View style={styles.bsoRow}>
            <Pressable style={styles.bsoBtn} hitSlop={6} onPress={onBall}>
              <Text style={styles.bsoLabel}>B</Text>
              <Text style={styles.bsoValue}>{baseballCount.balls}</Text>
            </Pressable>
            <Pressable style={styles.bsoBtn} hitSlop={6} onPress={onStrike}>
              <Text style={styles.bsoLabel}>S</Text>
              <Text style={styles.bsoValue}>{baseballCount.strikes}</Text>
            </Pressable>
            <Pressable style={styles.bsoBtn} hitSlop={6} onPress={onOut}>
              <Text style={[styles.bsoLabel, styles.bsoOutLabel]}>O</Text>
              <Text style={styles.bsoValue}>{baseballCount.outs}</Text>
            </Pressable>
            {/* 走者ダイヤ（タップで進塁/帰塁・二塁=上/三塁=左/一塁=右） */}
            <View style={styles.diamond}>
              <Pressable
                style={[styles.base, styles.baseSecond, baseballCount.runners.second && styles.baseOn]}
                hitSlop={8}
                onPress={() => onRunner("second")}
              />
              <Pressable
                style={[styles.base, styles.baseThird, baseballCount.runners.third && styles.baseOn]}
                hitSlop={8}
                onPress={() => onRunner("third")}
              />
              <Pressable
                style={[styles.base, styles.baseFirst, baseballCount.runners.first && styles.baseOn]}
                hitSlop={8}
                onPress={() => onRunner("first")}
              />
            </View>
          </View>
        </View>
      ) : null}

      {/* 下: スコア操作パネル */}
      <SafeAreaView style={[styles.controls, isPortrait && styles.controlsPortrait]} pointerEvents="box-none">
        <View style={[styles.teamControl, isPortrait && styles.teamControlPortrait]}>
          <Text style={[styles.controlTeamName, isPortrait && styles.controlTeamNamePortrait]} numberOfLines={1}>
            {homeTeam}
            {setBased ? `（${homeSets}${unitLabel}）` : ""}
          </Text>
          <View style={styles.scoreRow}>
            <Pressable style={[styles.minusBtn, isPortrait && styles.minusBtnPortrait]} hitSlop={6} onPress={() => onHome(-1)}>
              <Text style={[styles.btnSign, isPortrait && styles.btnSignPortrait]}>−</Text>
            </Pressable>
            <Text style={[styles.controlScore, isPortrait && styles.controlScorePortrait]}>{homeScore}</Text>
            {scoreSteps.length === 1 ? (
              <Pressable style={[styles.plusBtn, isPortrait && styles.plusBtnPortrait]} hitSlop={6} onPress={() => onHome(1)}>
                <Text style={[styles.btnSign, isPortrait && styles.btnSignPortrait]}>＋</Text>
              </Pressable>
            ) : null}
          </View>
          {scoreSteps.length > 1 ? (
            <View style={styles.plusStepRow}>
              {scoreSteps.map((s) => (
                <Pressable
                  key={s}
                  style={styles.plusStepBtn}
                  hitSlop={4}
                  onPress={() => onHome(s)}
                >
                  <Text style={styles.plusStepText}>+{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.centerControl}>
          {setBased ? (
            <Pressable style={styles.nextSetBtn} onPress={onNextSet}>
              <Text style={styles.nextSetText}>次の{unitLabel}へ ▸</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.periodBtn} onPress={onPeriod}>
              <Text style={styles.periodText}>{period} ▸</Text>
            </Pressable>
          )}
          <Pressable style={styles.shareBtn} onPress={share}>
            <Text style={styles.shareText}>📲 共有</Text>
          </Pressable>
          <Text style={styles.codeText}>視聴コード: {shareCode}</Text>
        </View>

        <View style={[styles.teamControl, isPortrait && styles.teamControlPortrait]}>
          <Text style={[styles.controlTeamName, isPortrait && styles.controlTeamNamePortrait]} numberOfLines={1}>
            {awayTeam}
            {setBased ? `（${awaySets}${unitLabel}）` : ""}
          </Text>
          <View style={styles.scoreRow}>
            <Pressable style={[styles.minusBtn, isPortrait && styles.minusBtnPortrait]} hitSlop={6} onPress={() => onAway(-1)}>
              <Text style={[styles.btnSign, isPortrait && styles.btnSignPortrait]}>−</Text>
            </Pressable>
            <Text style={[styles.controlScore, isPortrait && styles.controlScorePortrait]}>{awayScore}</Text>
            {scoreSteps.length === 1 ? (
              <Pressable style={[styles.plusBtn, isPortrait && styles.plusBtnPortrait]} hitSlop={6} onPress={() => onAway(1)}>
                <Text style={[styles.btnSign, isPortrait && styles.btnSignPortrait]}>＋</Text>
              </Pressable>
            ) : null}
          </View>
          {scoreSteps.length > 1 ? (
            <View style={styles.plusStepRow}>
              {scoreSteps.map((s) => (
                <Pressable
                  key={s}
                  style={styles.plusStepBtn}
                  hitSlop={4}
                  onPress={() => onAway(s)}
                >
                  <Text style={styles.plusStepText}>+{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      {/* 視聴者からの応援スタンプ（pointerEvents none で操作を邪魔しない） */}
      {shareCode ? <BroadcastReactions shareCode={shareCode} /> : null}
    </>
  );
}

// LiveKit 経路: WebRTC のカメラトラックをプレビューしつつ操作UIを重ねる。
function LiveView(props: ScoreControlsProps) {
  useKeepAwake(); // 配信中は画面をスリープさせない（長時間の発熱テスト対策）
  const tracks = useTracks([Track.Source.Camera]);
  const cam =
    tracks.find((t) => isTrackReference(t) && t.participant.isLocal) ?? tracks[0];
  return (
    <View style={styles.liveRoot}>
      {cam && isTrackReference(cam) ? (
        <VideoTrack trackRef={cam} style={styles.video} objectFit="cover" />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.connecting}>接続中...</Text>
        </View>
      )}
      <ScoreControls {...props} />
    </View>
  );
}

// ネイティブ RTMP 経路（Bunny）: 端末でカメラ＋スコア焼き込みを GPU 合成して RTMP 送信。
// プレビューは RtmpPublisherView 自身が描画する。操作UIは同じ ScoreControls を重ねる。
function RtmpLiveView(
  props: ScoreControlsProps & {
    rtmpUrl: string;
    scoreboardText: string;
    onStatus: (e: RtmpStatusEvent) => void;
  },
) {
  useKeepAwake();
  const { rtmpUrl, scoreboardText, onStatus, ...controls } = props;
  return (
    <View style={styles.liveRoot}>
      <RtmpPublisherView
        style={styles.video}
        streamUrl={rtmpUrl}
        active={true}
        videoWidth={1280}
        videoHeight={720}
        videoBitrate={6_000_000}
        fps={60}
        cameraPosition="back"
        scoreboardText={scoreboardText}
        scoreboardVisible={true}
        onStatus={onStatus}
      />
      <ScoreControls {...controls} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { padding: 24, flexGrow: 1, justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 20 },
  form: { gap: 8 },
  label: { color: "#bbb", fontSize: 13, marginTop: 4 },
  input: { backgroundColor: "#1a1a1a", color: "#fff", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#333" },
  ready: { color: "#ddd", fontSize: 15, textAlign: "center", marginBottom: 8 },
  summaryText: { color: "#8fd6a0", fontSize: 13, textAlign: "center", marginBottom: 4 },
  button: { backgroundColor: "#e63946", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkButton: { padding: 10, alignItems: "center" },
  linkText: { color: "#888", fontSize: 13 },
  message: { color: "#ffb4b4", marginTop: 16, textAlign: "center" },

  sportRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sportChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#444", backgroundColor: "#1a1a1a" },
  sportChipActive: { backgroundColor: "#e63946", borderColor: "#e63946" },
  sportChipText: { color: "#ccc", fontSize: 14, fontWeight: "600" },
  sportChipTextActive: { color: "#fff" },
  ruleHint: { color: "#9ab", fontSize: 12, marginTop: 2 },
  ytToggle: {
    borderWidth: 1,
    borderColor: "#444",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  ytToggleOn: { backgroundColor: "rgba(230,57,70,0.15)", borderColor: "#e63946" },
  ytToggleText: { color: "#ccc", fontSize: 14, fontWeight: "600" },
  ytToggleTextOn: { color: "#fff" },

  liveRoot: { flex: 1, backgroundColor: "#000" },
  video: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  connecting: { color: "#fff", marginTop: 8 },

  // 視聴者からの応援スタンプ層（下から上へ浮かぶ・操作非干渉）
  reactionLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  reactionEmoji: { position: "absolute", bottom: 150 },

  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 12,
  },
  scorePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 1,
  },
  previewTeam: { color: "#fff", fontWeight: "700", fontSize: 13, maxWidth: 84 },
  previewSets: { color: "#ffd24a", fontWeight: "900", fontSize: 14 },
  previewScore: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
    backgroundColor: "#e63946",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  previewPeriod: { color: "#ddd", fontSize: 12, marginLeft: 4 },
  topLeftGroup: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, maxWidth: "82%" },
  pointBadge: { backgroundColor: "#f4a300", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  pointBadgeMatch: { backgroundColor: "#e63946" },
  pointBadgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  stopButton: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderColor: "#e63946",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stopText: { color: "#e63946", fontWeight: "800", fontSize: 13 },
  topRightGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  youtubeStatus: { color: "#ff6b6b", fontWeight: "700" },
  elapsedText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontVariant: ["tabular-nums"],
  },
  trialWarn: { backgroundColor: "#e63946" },

  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    padding: 12,
    gap: 8,
  },
  teamControl: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 116,
  },
  controlTeamName: { color: "#fff", fontWeight: "700", fontSize: 12, marginBottom: 6, maxWidth: 140 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  minusBtn: { width: 44, height: 48, borderRadius: 22, backgroundColor: "#333", alignItems: "center", justifyContent: "center" },
  plusBtn: { width: 56, height: 48, borderRadius: 24, backgroundColor: "#e63946", alignItems: "center", justifyContent: "center" },
  btnSign: { color: "#fff", fontSize: 26, fontWeight: "800", lineHeight: 30 },
  // バスケの +1/+2/+3（スコア行の下に横並び）
  plusStepRow: { flexDirection: "row", gap: 6, marginTop: 6, justifyContent: "center" },
  plusStepBtn: {
    minWidth: 40,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "#e63946",
    alignItems: "center",
    justifyContent: "center",
  },
  plusStepText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // 野球 B/S/O＋走者ダイヤ（下部スコア操作の上に重ねる）
  baseballPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 132,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  bsoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bsoBtn: { alignItems: "center", minWidth: 34, paddingVertical: 2 },
  bsoLabel: { color: "#9fb3c8", fontSize: 11, fontWeight: "800" },
  bsoOutLabel: { color: "#ff8a8a" },
  bsoValue: { color: "#fff", fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  diamond: { width: 46, height: 46, marginLeft: 6 },
  base: {
    position: "absolute",
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderColor: "#9aa",
    transform: [{ rotate: "45deg" }],
  },
  baseSecond: { top: 1, left: 16 },
  baseThird: { top: 16, left: 1 },
  baseFirst: { top: 16, left: 31 },
  baseOn: { backgroundColor: "#ffd24a", borderColor: "#ffd24a" },
  controlScore: { color: "#fff", fontSize: 28, fontWeight: "900", minWidth: 36, textAlign: "center", fontVariant: ["tabular-nums"] },
  centerControl: { alignItems: "center", gap: 6 },
  periodBtn: { backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  periodText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  nextSetBtn: { backgroundColor: "#f4a300", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  nextSetText: { color: "#1a1a1a", fontWeight: "800", fontSize: 14 },
  shareBtn: { backgroundColor: "#1d9bf0", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  shareText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  codeText: { color: "#bbb", fontSize: 11 },

  // ===== 縦持ち時の詰めスタイル（横持ちは無変更。アウェイ側が画面外に切れないよう小型化） =====
  // 下部スコア操作
  controlsPortrait: { paddingHorizontal: 6, gap: 4 },
  teamControlPortrait: { minWidth: 84, paddingHorizontal: 4 },
  controlTeamNamePortrait: { fontSize: 11, maxWidth: 92, marginBottom: 4 },
  minusBtnPortrait: { width: 38, height: 44, borderRadius: 19 },
  plusBtnPortrait: { width: 46, height: 44, borderRadius: 23 },
  btnSignPortrait: { fontSize: 22, lineHeight: 26 },
  controlScorePortrait: { fontSize: 24, minWidth: 26 },
  // 上部スコアボード/ステータス
  previewTeamPortrait: { fontSize: 11, maxWidth: 52 },
  youtubeStatusPortrait: { fontSize: 12, paddingHorizontal: 6 },
  elapsedTextPortrait: { fontSize: 11, paddingHorizontal: 6, paddingVertical: 4 },
  stopButtonPortrait: { paddingHorizontal: 8, paddingVertical: 6 },
  stopTextPortrait: { fontSize: 12 },
});
