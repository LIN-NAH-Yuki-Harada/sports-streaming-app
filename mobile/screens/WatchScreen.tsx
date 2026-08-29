import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AudioSession,
  AndroidAudioTypePresets,
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useParticipants,
  useConnectionState,
  isTrackReference,
} from "@livekit/react-native";
import { Track, ConnectionState } from "livekit-client";
import { useVideoPlayer, VideoView } from "expo-video";
import { supabase } from "../lib/supabase";
import { LIVEKIT_URL } from "../config";
import {
  getBroadcastByCode,
  getStreamPlaybackUrl,
  fetchViewerToken,
  type WatchBroadcast,
} from "../lib/watch-data";
import { ScoreboardOverlay } from "../components/ScoreboardOverlay";
import { ModerationMenu } from "../components/ModerationMenu";
import { LiveReactions } from "../components/LiveReactions";
import { NoticeOverlay } from "../components/NoticeOverlay";
import type { RootStackParamList } from "../navigation-types";

// HLS(自前MediaMTX)視聴時、映像は約7秒遅れて届くため、リアルタイムのスコアを
// そのまま重ねると「映像より先に点が入る」ネタバレになる。スコア表示だけ映像遅延に
// 合わせて遅らせる（Web 版 watch/[code]/page.tsx の OVERLAY_DELAY_MS と同値）。
const OVERLAY_DELAY_MS = 7000;

// 右上バッジ類の上オフセット。横画面ではノッチが側面に移るため上インセットは
// 本来ほぼ0だが、回転時に縦持ちの値(〜59pt)が残るケースがあり、高さの浅い横画面で
// バッジが画面の15%も下に落ちて見える（2026-07-12 実戦FB）。横画面は上限20ptに抑える
// （ScoreboardOverlay と同じ扱い）。
function useTopInset(): number {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  return width > height ? Math.min(insets.top, 20) : insets.top;
}

// broadcast を delayMs ぶん遅らせて返す（Web 版 useDelayedBroadcast の移植）。
function useDelayedBroadcast(
  broadcast: WatchBroadcast | null,
  delayMs: number,
): WatchBroadcast | null {
  const [delayed, setDelayed] = useState<WatchBroadcast | null>(broadcast);
  const queueRef = useRef<{ value: WatchBroadcast; at: number }[]>([]);
  useEffect(() => {
    if (broadcast) queueRef.current.push({ value: broadcast, at: Date.now() });
  }, [broadcast]);
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - delayMs;
      const q = queueRef.current;
      let chosen: WatchBroadcast | null = null;
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

// 条件付きのスリープ抑止。expo-keep-awake の useKeepAwake は無条件なので、
// 命令APIを effect で包んで「必要な間だけ」抑止する。
function useKeepAwakeWhile(active: boolean) {
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [active]);
}
const KEEP_AWAKE_TAG = "spotch-watch";

// 開始前共有で受け取った人が、配信開始前にリンクを開いたときの待機設定。
const WAIT_FOR_START_POLL_MS = 10_000; // 10秒ごとに配信を探す
// ★ 2026-08-04: 60分は長すぎた。共有コードの**手打ちはアプリの主要導線**で、打ち間違えると
//   1.1.4 では即「見つかりません」だったのに、待機画面の導入で**60分待たされる**ようになった。
//   開始前共有の受け皿としては5分あれば足り（配信者は開始直前に共有する）、打ち間違いにも
//   早く気づける。あわせて待機画面に「コードが違う可能性」を併記する。
const WAIT_FOR_START_MAX_MS = 5 * 60_000; // 5分で打ち切り

// HLS 視聴の自動復帰ウォッチドッグ（Web 版 hls-player.tsx と同じ考え方・同じ値）。
const WATCHDOG_TICK_MS = 2000; // 監視間隔（web: STALL_TICK_MS）
const STALL_LIMIT = 3; // 約6秒 currentTime が進まなければ再同期（web: STALL_LIMIT）
// 「エラーにならず loading のまま戻ってこない」用。iOS はバッファ枯渇で status が
// error ではなく loading になるため、error 監視だけでは永久スピナーになる。
const LOADING_LIMIT = 5; // 約10秒 loading が続いたら再同期
// 再同期は m3u8 の読み直しなので数秒かかる。その間の再判定を止めて連打を防ぐ。
const RESYNC_COOLDOWN_MS = 10_000;

type Props = NativeStackScreenProps<RootStackParamList, "Watch">;

// アプリ内ネイティブ視聴画面。LiveKit で配信者の映像を直接購読して全画面表示する
// （Safari に飛ばさないのでブラウザのバーが出ない／スコアは ScoreboardOverlay で重ねる）。
export function WatchScreen({ route, navigation }: Props) {
  const { shareCode } = route.params;

  const [broadcast, setBroadcast] = useState<WatchBroadcast | null>(null);
  // ★ 2026-08-04: 無条件で抑止していたため、**待機画面のまま画面が消えない**。
  //   試合30分前にリンクを開いて車内や屋外で待つ祖父母がいるので電池を空にしかねない。
  //   → 映像が出ている（配信が live）間だけ抑止する。
  useKeepAwakeWhile(broadcast?.status === "live");
  const [loading, setLoading] = useState(true);
  // 未開始待ちが上限に達したか（true で「見つかりません」に切り替える）
  const [waitTimedOut, setWaitTimedOut] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  // 通報・ブロック用の自分のユーザーID（Play/App Store の UGC ポリシー対応）。
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [connectError, setConnectError] = useState(false);
  // 自前配信サーバー(MediaMTX)の HLS 視聴 URL。
  //   undefined = 解決中（LiveKit へ進まない） / null = 自前配信ではない（従来 LiveKit 経路）
  //   / string = HLS プレイヤーで再生（アプリ配信＝RTMP 経路の映像はここからしか来ない）
  const [playbackUrl, setPlaybackUrl] = useState<string | null | undefined>(
    undefined,
  );
  // 再読込（接続失敗/映像不達のリカバリ）用カウンタ。増やすと token 再取得＋LiveKitRoom 再マウント。
  const [attempt, setAttempt] = useState(0);
  const audioStartedRef = useRef(false);

  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const retry = useCallback(() => {
    setConnectError(false);
    setTokenError(false);
    setToken(null);
    setPlaybackUrl(undefined);
    setAttempt((a) => a + 1);
  }, []);

  // 自分のユーザーIDを取得（通報・ブロックの reporter として使う）。
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setCurrentUserId(data.session?.user.id ?? null);
      })
      .catch(() => {
        /* 取得失敗時は null のまま（ModerationMenu 側が案内を出す） */
      });
    return () => {
      active = false;
    };
  }, []);

  // broadcast の現在値をレンダリング外から参照するためのミラー
  // （再読込時の「取得失敗しても既存の試合情報を保持する」判定に使う）。
  const broadcastRef = useRef<WatchBroadcast | null>(null);
  useEffect(() => {
    broadcastRef.current = broadcast;
  }, [broadcast]);
  const prevCodeRef = useRef<string | null>(null);

  // 配信取得。shareCode 変化時は必ず初期状態へ戻す（別コードへ遷移しても古い試合が
  // 残らない）。attempt（再読込）時は既存の broadcast を保持したまま再解決する
  // （弱電波で getBroadcastByCode が一時失敗しても「見つかりません」終端に落とさない）。
  useEffect(() => {
    let active = true;
    const isNewCode = prevCodeRef.current !== shareCode;
    prevCodeRef.current = shareCode;
    if (isNewCode) {
      setBroadcast(null);
      setLoading(true);
    }
    setToken(null);
    setTokenError(false);
    setConnectError(false);
    setPlaybackUrl(undefined);
    (async () => {
      const b = await getBroadcastByCode(shareCode);
      if (!active) return;
      // 取得成功なら更新。失敗(null)でも再読込なら既存値で継続する。
      const effective = b ?? (isNewCode ? null : broadcastRef.current);
      if (b) setBroadcast(b);
      else if (isNewCode) setBroadcast(null);
      // live なら自前配信(HLS)かどうかを解決。null=従来 LiveKit 経路へ。
      if (effective?.status === "live") {
        const url = await getStreamPlaybackUrl(shareCode).catch(() => null);
        if (!active) return;
        setPlaybackUrl(url);
      } else {
        setPlaybackUrl(null);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [shareCode, attempt]);

  // 同一共有コードのまま新しい配信行に切り替わったら（配信の立て直し・コード再利用）、
  // 視聴経路(HLS/LiveKit)を最初から解決し直す。旧配信の HLS URL や LiveKit token を
  // 使い続けると「死んだ m3u8 を再ロードし続ける／空の部屋を見続ける」事故になるため。
  const watchedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = broadcast?.id ?? null;
    if (!id) return;
    if (watchedIdRef.current === null) {
      watchedIdRef.current = id;
      return;
    }
    if (watchedIdRef.current !== id) {
      watchedIdRef.current = id;
      setToken(null);
      setTokenError(false);
      setConnectError(false);
      setPlaybackUrl(undefined);
      (async () => {
        const url = await getStreamPlaybackUrl(shareCode).catch(() => null);
        setPlaybackUrl(url);
      })();
    }
  }, [broadcast?.id, shareCode]);

  // live かつ自前配信でない(playbackUrl===null)とき視聴トークン取得＋AudioSession 構成。
  // 視聴は「再生専用」なので Android は communication ではなく media プリセットで構成する
  // （受話口/小音量/AGCダッキングを回避）。attempt を増やすと再取得（再読込リカバリ）。
  useEffect(() => {
    if (!broadcast || broadcast.status !== "live") return;
    if (playbackUrl !== null) return; // undefined=解決待ち / string=HLS 経路
    let active = true;
    (async () => {
      const t = await fetchViewerToken(shareCode);
      if (!active) return;
      if (t) {
        await AudioSession.configureAudio({
          android: { audioTypeOptions: AndroidAudioTypePresets.media },
          ios: { defaultOutput: "speaker" },
        }).catch(() => {});
        await AudioSession.startAudioSession().catch(() => {});
        audioStartedRef.current = true;
        setToken(t);
      } else {
        setTokenError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [broadcast?.id, broadcast?.status, shareCode, attempt, playbackUrl]);

  // HLS(自前配信)視聴のオーディオは expo-video が自前で適切な AudioSession を
  // 構成する（iOS playback カテゴリ等）ため、LiveKit の AudioSession は触らない
  // （二重構成するとカテゴリ設定が競合し、サイレントスイッチ挙動が不安定になる）。

  // アンマウント時に AudioSession を必ず停止（解放漏れ防止）。
  useEffect(() => {
    return () => {
      if (audioStartedRef.current) {
        AudioSession.stopAudioSession().catch(() => {});
        audioStartedRef.current = false;
      }
    };
  }, []);

  // Realtime: スコア更新を購読し、該当 broadcast.id の行だけ差し替える。
  useEffect(() => {
    if (!broadcast?.id) return;
    const channel = supabase
      .channel(`watch-${broadcast.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "broadcasts",
          filter: `id=eq.${broadcast.id}`,
        },
        (payload) => {
          setBroadcast((prev) =>
            prev
              ? { ...prev, ...(payload.new as Partial<WatchBroadcast>) }
              : prev,
          );
        },
      )
      .subscribe();
    return () => {
      channel.unsubscribe().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, [broadcast?.id]);

  // フォールバック: Realtime 不達に備え、live のとき 5 秒ごとに最新化。
  // あわせて playbackUrl も再解決する（Web 版と同じ）——配信開始直後は provision 完了
  // まで stream_playback_url が null のため、最初の解決で null でも後から string に
  // 昇格させる（これが無いとアプリ配信の視聴が LiveKit 経路に固定され映像が来ない）。
  // string が取れなかった場合は降格しない（一時的な取得失敗で HLS を落とさない）。
  useEffect(() => {
    if (!broadcast || broadcast.status !== "live") return;
    const id = setInterval(async () => {
      const updated = await getBroadcastByCode(shareCode);
      if (updated) setBroadcast((prev) => (prev ? { ...prev, ...updated } : updated));
      if (updated?.status === "live") {
        const url = await getStreamPlaybackUrl(shareCode).catch(() => null);
        if (typeof url === "string") {
          setPlaybackUrl((prev) => (prev === url ? prev : url));
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [broadcast?.id, broadcast?.status, shareCode]);

  // 未作成コードの待機ポーリング（開始前共有・案C の受け皿）。
  // 配信開始**前**にリンクを共有できるようにしたため、家族が開始前に開く経路が正常系になった。
  // ここで「見つかりません」で終端すると開き直しを強いるので、10秒ごとに探し続け、
  // 配信が始まったら自動で切り替える。上限 60 分（無期限ポーリングで電池を食わない）。
  //
  // ★ このフックは**必ず早期 return より前**に置くこと。React のフックは毎レンダー同じ順序で
  //   呼ばれる必要があり、`if (loading) return` の後ろに置くと初回レンダーで呼ばれず、
  //   loading=false になった瞬間にフック数が変わって**必ずクラッシュする**（2026-08-03 に実際に
  //   踏んだ。tsc では検出できない）。
  useEffect(() => {
    if (loading || broadcast) return;
    const startedAt = Date.now();
    const id = setInterval(async () => {
      if (Date.now() - startedAt > WAIT_FOR_START_MAX_MS) {
        clearInterval(id);
        setWaitTimedOut(true);
        return;
      }
      const b = await getBroadcastByCode(shareCode).catch(() => null);
      if (b) setBroadcast(b);
    }, WAIT_FOR_START_POLL_MS);
    return () => clearInterval(id);
  }, [loading, broadcast, shareCode]);

  // ===== 読み込み中 =====
  if (loading) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color="#e63946" />
        <CloseButton onPress={close} />
      </View>
    );
  }


  // ===== 配信が見つからない =====
  if (!broadcast) {
    // コードの打ち間違いと「まだ始まっていない」を画面上で区別できないため、両方に
    // 当てはまる書き方にし、コードを併記して打ち間違いにも気づけるようにする。
    return waitTimedOut ? (
      <Message
        title="配信が見つかりません"
        sub={`共有コード「${shareCode}」に該当する配信はありません。コードをご確認ください。`}
        onClose={close}
      />
    ) : (
      <Message
        title="配信はまだ始まっていません"
        sub={`共有コード「${shareCode}」\nこの画面のままお待ちください。始まると自動で映像に切り替わります。\n（コードが違う可能性もあります）`}
        onClose={close}
      >
        <ActivityIndicator color="#e63946" />
      </Message>
    );
  }

  // ===== 終了 / アーカイブ =====
  if (broadcast.status !== "live") {
    // Web 版と同じフォールバック: youtube_video_id 優先、無ければ live 正常終了時に
    // live_youtube_broadcast_id（同一動画ID）を使う。
    const archiveId =
      broadcast.youtube_video_id ??
      (broadcast.live_status === "ended"
        ? broadcast.live_youtube_broadcast_id
        : null);
    return (
      <Message
        title="この配信は終了しました"
        sub="ご視聴ありがとうございました"
        onClose={close}
      >
        {archiveId ? (
          <Pressable
            style={styles.ytBtn}
            onPress={() =>
              Linking.openURL(
                `https://www.youtube.com/watch?v=${archiveId}`,
              ).catch(() => {})
            }
          >
            <Text style={styles.ytBtnText}>YouTube でアーカイブを見る</Text>
          </Pressable>
        ) : null}
      </Message>
    );
  }

  // ===== 自前配信(RTMP→MediaMTX)の HLS 視聴 =====
  // アプリ配信の映像は LiveKit には来ないため、この分岐でしか再生できない。
  if (broadcast.status === "live" && typeof playbackUrl === "string") {
    return (
      <HlsStage
        broadcast={broadcast}
        url={playbackUrl}
        currentUserId={currentUserId}
        onClose={close}
        onReload={retry}
      />
    );
  }

  // ===== 自前配信かどうかの解決待ち =====
  if (broadcast.status === "live" && playbackUrl === undefined) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color="#e63946" />
        <Text style={styles.connecting}>接続中...</Text>
        <CloseButton onPress={close} />
      </View>
    );
  }

  // ===== 接続失敗 / トークン取得失敗 =====
  if (connectError || tokenError) {
    return (
      <Message
        title="接続できませんでした"
        sub="電波の良い場所で、もう一度お試しください。"
        onClose={close}
      >
        <Pressable style={styles.ytBtn} onPress={retry}>
          <Text style={styles.ytBtnText}>再試行</Text>
        </Pressable>
      </Message>
    );
  }

  // ===== トークン取得待ち =====
  if (!token) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color="#e63946" />
        <Text style={styles.connecting}>接続中...</Text>
        <CloseButton onPress={close} />
      </View>
    );
  }

  // ===== 視聴中（LiveKit 接続） =====
  return (
    <LiveKitRoom
      key={attempt}
      serverUrl={LIVEKIT_URL}
      token={token}
      connect={true}
      audio={false}
      video={false}
      options={{ adaptiveStream: true, dynacast: true }}
      onError={(e) => {
        console.error("[watch] LiveKit error:", e?.message);
        setConnectError(true);
      }}
    >
      <Stage
        broadcast={broadcast}
        currentUserId={currentUserId}
        onClose={close}
        onReload={retry}
      />
    </LiveKitRoom>
  );
}

// 自前配信サーバー(MediaMTX)の HLS を expo-video で再生するステージ。
// Web 版 hls-player.tsx の中断耐性の簡易版:
//  - エラー時は 3 秒ごとに同じ URL を再ロード（配信者の一時中断で m3u8 が
//    404/stale になる間もプレイヤーを破棄せず粘る）
//  - 30 秒映像が始まらなければ再読込/戻る導線を出す（永久スピナー回避）
// スコアは HLS 遅延(約7秒)に合わせて delayedBroadcast で同期表示する。
function HlsStage({
  broadcast,
  url,
  currentUserId,
  onClose,
  onReload,
}: {
  broadcast: WatchBroadcast;
  url: string;
  currentUserId: string | null;
  onClose: () => void;
  onReload: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topInset = useTopInset();
  const [modVisible, setModVisible] = useState(false);
  // スコアは映像の HLS 遅延に合わせて遅らせる（ネタバレ防止）。
  const delayed = useDelayedBroadcast(broadcast, OVERLAY_DELAY_MS);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });
  // 初期値はプレイヤーの実ステータス（"loading" 固定だと、リスナー登録前に
  // readyToPlay へ遷移し終えた場合にオーバーレイが消えなくなるレースがある）。
  const [playerStatus, setPlayerStatus] = useState<string>(() => player.status);

  // 直近に再同期した時刻。復帰はロードに数秒かかるので、その間ウォッチドッグが
  // 「まだ止まっている」と誤判定して連打しないためのクールダウンに使う。
  const lastResyncAtRef = useRef(0);

  // ライブ先頭へ再同期して再生し直す（エラー復帰・背景復帰・ストール共通）。
  // replace は同期版だと iOS でメインスレッドロード＋非推奨警告のため replaceAsync。
  const resync = useCallback(() => {
    lastResyncAtRef.current = Date.now();
    try {
      player
        .replaceAsync(url)
        .then(() => player.play())
        .catch(() => {
          /* 解放済み・ロード失敗は無視（次のリトライ/statusChangeに任せる） */
        });
    } catch {
      /* プレイヤー解放済み。expo-video は解放後のメソッド呼び出しで**同期例外**を
         投げるため .catch() では拾えない。タイマーから呼ばれるので握りつぶす。 */
    }
  }, [player, url]);

  // エラー時の自動リトライ（3秒間隔・アンマウントで停止）。
  useEffect(() => {
    // 登録前に遷移し終えている可能性に備えて現在値を種まき
    setPlayerStatus(player.status);
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = player.addListener("statusChange", ({ status }) => {
      setPlayerStatus(status);
      if (status === "error") {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(resync, 3000);
      }
    });
    return () => {
      sub.remove();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [player, resync]);

  // バックグラウンド復帰時の再開。expo-video は背面移行で自動 pause するが、
  // 復帰時に play() を呼ばないため放置すると「静止画のままスコアだけ動く」凍結になる。
  // ライブは追っかけ再生でなく先頭へ再同期する。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") resync();
    });
    return () => sub.remove();
  }, [resync]);

  // ストール監視（Web 版 hls-player の watchdog 相当）。配信者の回線切替などで
  // セグメント列が不連続になると、エラーにならず再生位置だけ止まることがある。
  //
  // ★ 2026-08-05: timeUpdate 駆動をやめて setInterval 駆動にした。
  //   iOS の timeUpdate は AVPlayer.addPeriodicTimeObserver 実装で、Apple の仕様は
  //   「interpreted according to the timeline of the current item」＝**再生タイムライン駆動**。
  //   つまり再生が止まるとイベント自体が来なくなる（止まる瞬間に1回来るだけ）。
  //   「止まったことを、止まると来なくなるイベントで検知する」構造だったため、
  //   iPhone ではストール検知が**原理的に発火しなかった**。
  //   （Android の timeUpdate は Handler の実時間ループなので発火する＝この穴は iOS 限定。
  //     2026-08-04 の「背面で通信を食う」も Android だけで起きたのはこのため。）
  //   実時間の setInterval から currentTime を読みに行けば両OSで検知できる。
  //   あわせて「エラーにならず loading のまま戻ってこない」も同じループで拾う
  //   （iOS はバッファ枯渇で status が error ではなく loading になるため、
  //     statusChange の error 監視だけでは 30 秒後の手動「再読込」まで復帰しない）。
  useEffect(() => {
    let lastTime = -1;
    let stuck = 0;
    let loadingTicks = 0;
    let everPlayed = false;
    const id = setInterval(() => {
      // アプリが前面にいないときは何もしない。前面でないのに resync() → play() すると
      // 画面に出ていないのに通信量と電池を食い続ける（2026-08-04 の Android 事案）。
      if (AppState.currentState !== "active") {
        stuck = 0;
        loadingTicks = 0;
        return;
      }
      let status: string;
      let time: number;
      let playing: boolean;
      try {
        status = player.status;
        time = player.currentTime;
        playing = player.playing;
      } catch {
        return; // 解放済みプレイヤー（アンマウント直後など）
      }
      if (status === "readyToPlay") everPlayed = true;

      // 再同期直後はロードに数秒かかる。その間は判定しない（連打・無限リロード防止）。
      if (Date.now() - lastResyncAtRef.current < RESYNC_COOLDOWN_MS) {
        stuck = 0;
        loadingTicks = 0;
        lastTime = time;
        return;
      }

      // error は既存の statusChange リトライ（3秒）に任せる。idle は再生対象なし。
      if (status === "error" || status === "idle") {
        stuck = 0;
        loadingTicks = 0;
        lastTime = time;
        return;
      }

      if (status === "loading") {
        stuck = 0;
        // 初回ロードは弱電波だと10秒以上かかる。途中で叩き落とすと永久にロードできなく
        // なるので、**一度でも再生できた後**の loading だけ復帰対象にする。
        loadingTicks = everPlayed ? loadingTicks + 1 : 0;
        if (loadingTicks >= LOADING_LIMIT) {
          loadingTicks = 0;
          resync();
        }
        return;
      }

      // ここから status === "readyToPlay"
      loadingTicks = 0;
      // 視聴画面に一時停止ボタンは無いので「前面なのに再生していない」も異常扱いにする
      // （背面復帰の play() が失敗して静止画のまま固まるケースの受け皿）。
      if (!playing || time <= lastTime + 0.01) {
        stuck++;
        if (stuck >= STALL_LIMIT) {
          stuck = 0;
          resync();
        }
      } else {
        stuck = 0;
      }
      lastTime = time;
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, [player, resync]);

  // 30秒再生が始まらなければ手動リカバリ導線（永久スピナー回避）。
  const [slow, setSlow] = useState(false);
  const playing = playerStatus === "readyToPlay";
  useEffect(() => {
    if (playing) {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 30000);
    return () => clearTimeout(id);
  }, [playing]);

  const tournamentLabel = broadcast.tournament || broadcast.sport;

  return (
    <View style={styles.stage}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />

      {/* 読み込み中/中断中の表示（映像が来たら消える） */}
      {!playing ? (
        <View style={[StyleSheet.absoluteFill, styles.fill]}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.connecting}>
            {playerStatus === "error"
              ? "配信の中断から復帰を試みています..."
              : "配信者の映像を待っています..."}
          </Text>
          {slow ? (
            <View style={styles.recoverRow}>
              <Pressable style={styles.recoverBtn} onPress={onReload}>
                <Text style={styles.recoverText}>再読込</Text>
              </Pressable>
              <Pressable style={styles.recoverBtnGhost} onPress={onClose}>
                <Text style={styles.recoverText}>戻る</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* スコアボード（映像遅延に同期させた値で表示） */}
      <ScoreboardOverlay b={delayed ?? broadcast} delayMs={OVERLAY_DELAY_MS} />

      {/* 上部中央: 配信者からのお知らせ（変わった瞬間だけポップアップ→常設の帯へ）。
          スコアと違い遅延させない（Web 版が非遅延の broadcast.notice を使うため）。 */}
      <NoticeOverlay notice={broadcast.notice} topInset={topInset} />

      {/* 右上: LIVE + 試合名（視聴者数は LiveKit 由来のため HLS 視聴では非表示） */}
      <View
        style={[styles.topRight, { top: topInset + 10, right: 12 }]}
        pointerEvents="none"
      >
        <View style={styles.liveRow}>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>
        {tournamentLabel ? (
          <View style={styles.matchBadge}>
            <Text style={styles.matchText} numberOfLines={1}>
              {tournamentLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {/* 応援スタンプ（送信ボタン付き・右端） */}
      <LiveReactions
        shareCode={broadcast.share_code}
        showButtons
        buttonsBottom={insets.bottom + 62}
      />

      {/* 右下: 通報・ブロック（⋯）＋ 視聴を終了 */}
      <View
        style={[styles.bottomActions, { bottom: insets.bottom + 14, right: 14 }]}
      >
        <Pressable
          style={styles.actionBtn}
          onPress={() => setModVisible(true)}
          hitSlop={8}
        >
          <Text style={styles.closeInlineText}>⋯</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={onClose} hitSlop={8}>
          <Text style={styles.closeInlineText}>✕ 視聴を終了</Text>
        </Pressable>
      </View>

      <ModerationMenu
        visible={modVisible}
        currentUserId={currentUserId}
        target={{
          broadcastId: broadcast.id,
          broadcasterId: broadcast.broadcaster_id,
          shareCode: broadcast.share_code,
          label: `${broadcast.home_team} vs ${broadcast.away_team}`,
        }}
        onClose={() => setModVisible(false)}
        onBlocked={() => {
          setModVisible(false);
          onClose();
        }}
      />
    </View>
  );
}

// LiveKit 接続後のステージ（映像 + オーバーレイ + 右上情報 + 終了/再読込 + 通報）。
function Stage({
  broadcast,
  currentUserId,
  onClose,
  onReload,
}: {
  broadcast: WatchBroadcast;
  currentUserId: string | null;
  onClose: () => void;
  onReload: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topInset = useTopInset();
  // 通報・ブロックメニュー（UGC ポリシー: コンテンツの消費地点に通報手段を置く）。
  const [modVisible, setModVisible] = useState(false);
  const connState = useConnectionState();
  const tracks = useTracks([Track.Source.Camera]);
  const participants = useParticipants();
  // 配信者の映像（自分=ローカルではない方）を選ぶ。
  const cam =
    tracks.find((t) => isTrackReference(t) && !t.participant.isLocal) ?? tracks[0];
  const hasVideo = !!cam && isTrackReference(cam);
  // 視聴者数＝identity が "viewer-" で始まる参加者（配信者/Egress を除外。自分も含む）。
  const viewerCount = participants.filter((p) =>
    p.identity?.startsWith("viewer-"),
  ).length;
  const tournamentLabel = broadcast.tournament || broadcast.sport;

  // 接続済みなのに映像が一定時間来ない＝配信者の準備中/ゴースト/瞬断。永久スピナーを避ける。
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (hasVideo) {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 30000);
    return () => clearTimeout(id);
  }, [hasVideo]);

  const reconnecting =
    connState === ConnectionState.Reconnecting ||
    connState === ConnectionState.SignalReconnecting;
  const disconnected = connState === ConnectionState.Disconnected;

  return (
    <View style={styles.stage}>
      {hasVideo ? (
        <VideoTrack
          trackRef={cam}
          style={StyleSheet.absoluteFill}
          objectFit="contain"
        />
      ) : (
        <View style={styles.fill}>
          {!disconnected ? <ActivityIndicator color="#fff" /> : null}
          <Text style={styles.connecting}>
            {disconnected
              ? "配信が切断されました"
              : reconnecting
                ? "再接続中..."
                : "配信者の映像を待っています..."}
          </Text>
          {(slow || disconnected) ? (
            <View style={styles.recoverRow}>
              <Pressable style={styles.recoverBtn} onPress={onReload}>
                <Text style={styles.recoverText}>再読込</Text>
              </Pressable>
              <Pressable style={styles.recoverBtnGhost} onPress={onClose}>
                <Text style={styles.recoverText}>戻る</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      {/* スコアボード（左上 + 左下 経過時間） */}
      <ScoreboardOverlay b={broadcast} />

      {/* 上部中央: 配信者からのお知らせ（変わった瞬間だけポップアップ→常設の帯へ） */}
      <NoticeOverlay notice={broadcast.notice} topInset={topInset} />

      {/* 右上: LIVE + 視聴者数 + 試合名（縦に積んで重なり回避） */}
      <View
        style={[styles.topRight, { top: topInset + 10, right: 12 }]}
        pointerEvents="none"
      >
        <View style={styles.liveRow}>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>👁 {viewerCount}</Text>
          </View>
        </View>
        {tournamentLabel ? (
          <View style={styles.matchBadge}>
            <Text style={styles.matchText} numberOfLines={1}>
              {tournamentLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {/* 応援スタンプ（送信ボタン付き・右端。LiveKit はほぼリアルタイムなので遅延同期不要） */}
      <LiveReactions
        shareCode={broadcast.share_code}
        showButtons
        buttonsBottom={insets.bottom + 62}
      />

      {/* 右下: 通報・ブロック（⋯）＋ 視聴を終了。
          左下はスコアボードの経過時間表示が使うため、操作ボタンは右下に集約する。 */}
      <View
        style={[styles.bottomActions, { bottom: insets.bottom + 14, right: 14 }]}
      >
        <Pressable
          style={styles.actionBtn}
          onPress={() => setModVisible(true)}
          hitSlop={8}
        >
          <Text style={styles.closeInlineText}>⋯</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={onClose} hitSlop={8}>
          <Text style={styles.closeInlineText}>✕ 視聴を終了</Text>
        </Pressable>
      </View>

      {/* 通報・ブロックメニュー。ブロックしたら視聴画面から退出する。 */}
      <ModerationMenu
        visible={modVisible}
        currentUserId={currentUserId}
        target={{
          broadcastId: broadcast.id,
          broadcasterId: broadcast.broadcaster_id,
          shareCode: broadcast.share_code,
          label: `${broadcast.home_team} vs ${broadcast.away_team}`,
        }}
        onClose={() => setModVisible(false)}
        onBlocked={() => {
          setModVisible(false);
          onClose();
        }}
      />
    </View>
  );
}

// 全画面のメッセージ表示（見つからない/終了/エラー）。
function Message({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.fill, styles.messagePad]}>
      <Text style={styles.messageTitle}>{title}</Text>
      {sub ? <Text style={styles.messageSub}>{sub}</Text> : null}
      {children}
      <Pressable style={styles.backBtn} onPress={onClose}>
        <Text style={styles.backBtnText}>← 戻る</Text>
      </Pressable>
    </View>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      style={[styles.closeInline, { bottom: insets.bottom + 14, right: 14 }]}
      onPress={onPress}
      hitSlop={8}
    >
      <Text style={styles.closeInlineText}>✕ 視聴を終了</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  stage: { flex: 1, backgroundColor: "#000" },
  connecting: { color: "#fff", marginTop: 10, fontSize: 13 },
  recoverRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  recoverBtn: {
    backgroundColor: "#e63946",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  recoverBtnGhost: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  recoverText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // 右上 情報群
  topRight: { position: "absolute", alignItems: "flex-end", gap: 6 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#e63946",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  countBadge: {
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  countText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  matchBadge: {
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 220,
  },
  matchText: { color: "#e5e7eb", fontSize: 12, fontWeight: "600" },

  // 右下の操作ボタン行（⋯ / ✕ 視聴を終了）
  bottomActions: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  // 視聴を終了（読み込み中などの単独表示用）
  closeInline: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  closeInlineText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  // メッセージ画面
  messagePad: { paddingHorizontal: 32 },
  messageTitle: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  messageSub: {
    color: "#9ca3af",
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
  ytBtn: {
    marginTop: 20,
    backgroundColor: "#e63946",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  ytBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  backBtn: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backBtnText: { color: "#ddd", fontSize: 13, fontWeight: "600" },
});
