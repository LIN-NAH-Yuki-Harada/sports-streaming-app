import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useParticipants,
  isTrackReference,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { supabase } from "../lib/supabase";
import { LIVEKIT_URL } from "../config";
import {
  getBroadcastByCode,
  fetchViewerToken,
  type WatchBroadcast,
} from "../lib/watch-data";
import { ScoreboardOverlay } from "../components/ScoreboardOverlay";
import type { RootStackParamList } from "../navigation-types";

type Props = NativeStackScreenProps<RootStackParamList, "Watch">;

// アプリ内ネイティブ視聴画面。LiveKit で配信者の映像を直接購読して全画面表示する
// （Safari に飛ばさないのでブラウザのバーが出ない／スコアは ScoreboardOverlay で重ねる）。
export function WatchScreen({ route, navigation }: Props) {
  const { shareCode } = route.params;
  useKeepAwake(); // 視聴中はスリープさせない

  const [broadcast, setBroadcast] = useState<WatchBroadcast | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const audioStartedRef = useRef(false);

  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // 初回: 配信を取得 → live ならトークン取得 + AudioSession 開始。
  useEffect(() => {
    let active = true;
    (async () => {
      const b = await getBroadcastByCode(shareCode);
      if (!active) return;
      setBroadcast(b);
      setLoading(false);
      if (b && b.status === "live") {
        const t = await fetchViewerToken(shareCode);
        if (!active) return;
        if (t) {
          await AudioSession.startAudioSession().catch(() => {});
          audioStartedRef.current = true;
          setToken(t);
        } else {
          setTokenError(true);
        }
      }
    })();
    return () => {
      active = false;
      if (audioStartedRef.current) {
        AudioSession.stopAudioSession().catch(() => {});
        audioStartedRef.current = false;
      }
    };
  }, [shareCode]);

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
  useEffect(() => {
    if (!broadcast || broadcast.status !== "live") return;
    const id = setInterval(async () => {
      const updated = await getBroadcastByCode(shareCode);
      if (updated) setBroadcast((prev) => (prev ? { ...prev, ...updated } : updated));
    }, 5000);
    return () => clearInterval(id);
  }, [broadcast?.id, broadcast?.status, shareCode]);

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
    return (
      <Message
        title="配信が見つかりません"
        sub={`共有コード「${shareCode}」に該当する配信はありません。`}
        onClose={close}
      />
    );
  }

  // ===== 終了 / アーカイブ =====
  if (broadcast.status !== "live") {
    const ytId = broadcast.live_youtube_broadcast_id;
    return (
      <Message
        title="この配信は終了しました"
        sub="ご視聴ありがとうございました"
        onClose={close}
      >
        {ytId ? (
          <Pressable
            style={styles.ytBtn}
            onPress={() =>
              Linking.openURL(`https://www.youtube.com/watch?v=${ytId}`).catch(
                () => {},
              )
            }
          >
            <Text style={styles.ytBtnText}>YouTube でアーカイブを見る</Text>
          </Pressable>
        ) : null}
      </Message>
    );
  }

  // ===== 視聴トークン取得失敗 =====
  if (tokenError) {
    return (
      <Message
        title="接続できませんでした"
        sub="電波の良い場所で、もう一度お試しください。"
        onClose={close}
      />
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
      serverUrl={LIVEKIT_URL}
      token={token}
      connect={true}
      audio={false}
      video={false}
      onError={(e) => console.error("[watch] LiveKit error:", e?.message)}
    >
      <Stage broadcast={broadcast} onClose={close} />
    </LiveKitRoom>
  );
}

// LiveKit 接続後のステージ（映像 + オーバーレイ + 右上情報 + 終了ボタン）。
function Stage({
  broadcast,
  onClose,
}: {
  broadcast: WatchBroadcast;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tracks = useTracks([Track.Source.Camera]);
  const participants = useParticipants();
  // 配信者の映像（自分=ローカルではない方）を選ぶ。
  const cam =
    tracks.find((t) => isTrackReference(t) && !t.participant.isLocal) ?? tracks[0];
  const tournamentLabel = broadcast.tournament || broadcast.sport;

  return (
    <View style={styles.stage}>
      {cam && isTrackReference(cam) ? (
        <VideoTrack
          trackRef={cam}
          style={StyleSheet.absoluteFill}
          objectFit="contain"
        />
      ) : (
        <View style={styles.fill}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.connecting}>接続中...</Text>
        </View>
      )}

      {/* スコアボード（左上 + 左下 経過時間） */}
      <ScoreboardOverlay b={broadcast} />

      {/* 右上: LIVE + 視聴者数 + 試合名（縦に積んで重なり回避） */}
      <View
        style={[styles.topRight, { top: insets.top + 10, right: 12 }]}
        pointerEvents="none"
      >
        <View style={styles.liveRow}>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>👁 {participants.length}</Text>
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

      {/* 右下: 視聴を終了 */}
      <Pressable
        style={[styles.closeInline, { bottom: insets.bottom + 14, right: 14 }]}
        onPress={onClose}
        hitSlop={8}
      >
        <Text style={styles.closeInlineText}>✕ 視聴を終了</Text>
      </Pressable>
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

  // 視聴を終了（右下）
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
