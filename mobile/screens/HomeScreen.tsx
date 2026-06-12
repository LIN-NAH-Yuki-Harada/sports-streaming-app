import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { SITE_URL } from "../config";
import { fetchMyTeams, type MyTeam } from "../lib/teams";
import {
  fetchMyLiveBroadcasts,
  fetchUpcomingSchedules,
  sportEmoji,
  type HomeBroadcast,
  type HomeSchedule,
} from "../lib/home-data";
import { fetchBlockedIds } from "../lib/moderation";
import {
  ModerationMenu,
  type ModerationTarget,
} from "../components/ModerationMenu";

// ホームタブ。視聴者・配信者の両方が使う入り口。
// (a) 共有コード視聴: コード入力 → 自社プレイヤー(Web)を Linking で開く。
// (b) あなたに関係する LIVE 配信: 自分 or 所属チームの status="live" をカード表示。
//     スコアは Supabase Realtime(broadcasts UPDATE) で即時反映する。
// (c) あなたのチーム: lib/teams.fetchMyTeams で一覧表示。
// (d) 次の予定: team_schedules の今後分を閲覧表示（v1 は閲覧のみ）。
// 配信は別タブ(BroadcastScreen)。視聴は当面 Web に委譲する。

const SHARE_CHARS_MAX = 8;

// 共有コードを大文字化＋使用文字種だけに整える（Web の ShareCodeInput と同じく toUpperCase）。
function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, SHARE_CHARS_MAX);
}

// 予定の開始日時を「M/D (曜) HH:MM」に整形。
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
function formatScheduleTime(iso: string): string {
  try {
    const d = new Date(iso);
    const wd = WEEKDAYS[d.getDay()];
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} (${wd}) ${hh}:${mm}`;
  } catch {
    return "";
  }
}

export function HomeScreen() {
  const [code, setCode] = useState("");
  const [uid, setUid] = useState<string | null>(null);

  const [live, setLive] = useState<HomeBroadcast[]>([]);
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [schedules, setSchedules] = useState<HomeSchedule[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // モデレーション（通報・ブロック）。ブロック済み配信者はカードから除外する。
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [modTarget, setModTarget] = useState<ModerationTarget | null>(null);

  // Realtime チャンネルの解放用 ref（再購読時に前のを必ず外す）。
  const channelRef = useRef<RealtimeChannel | null>(null);

  // 視聴: 自社プレイヤー(Web)の watch URL を外部ブラウザで開く。視聴は当面 Web。
  const openWatch = useCallback((shareCode: string) => {
    const c = shareCode.trim();
    if (!c) return;
    Linking.openURL(`${SITE_URL}/watch/${c}`).catch(() => {});
  }, []);

  // ホームのデータをまとめて取得する（所属チーム → LIVE/予定 を並列）。
  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id ?? null;
    setUid(userId);
    if (!userId) {
      setLive([]);
      setTeams([]);
      setSchedules([]);
      return;
    }
    // 所属チームを先に取得し、その team_id 群で LIVE / 予定を引く。
    const myTeams = await fetchMyTeams(userId);
    const teamIds = myTeams.map((t) => t.id);
    const [liveRows, scheduleRows, blocked] = await Promise.all([
      fetchMyLiveBroadcasts(userId, teamIds),
      fetchUpcomingSchedules(teamIds, 20),
      fetchBlockedIds(userId),
    ]);
    setTeams(myTeams);
    setBlockedIds(blocked);
    // ブロック済み配信者の配信は表示しない（Guideline 1.2 のフィルタ）。
    setLive(liveRows.filter((b) => !blocked.includes(b.broadcaster_id)));
    setSchedules(scheduleRows);
  }, []);

  // タブにフォーカスが当たるたびに最新化（配信開始/終了を反映）。
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      // load() 内の fetch/クエリが弱電波で throw しても画面を落とさない最終防衛。
      load()
        .catch((e) => console.error("ホーム読み込みエラー:", e))
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  // 引っ張って更新。
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // LIVE 配信のスコア/ピリオドを Realtime で即時反映。
  // broadcasts の UPDATE を購読し、表示中カードの該当行だけ差し替える。
  // status が live 以外に変わった行はリストから除外（配信終了をリアルタイム反映）。
  useEffect(() => {
    // 解放: 既存チャンネルがあれば必ず外す。
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (!uid) return;

    const channel = supabase
      .channel("home-live-broadcasts")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "broadcasts" },
        (payload) => {
          const row = payload.new as Partial<HomeBroadcast> & { id?: string };
          if (!row?.id) return;
          setLive((prev) => {
            const idx = prev.findIndex((b) => b.id === row.id);
            if (idx === -1) return prev; // 表示中でない配信は無視
            // live 以外に遷移したら除外（終了をリアルタイム反映）
            if (row.status && row.status !== "live") {
              return prev.filter((b) => b.id !== row.id);
            }
            const next = prev.slice();
            next[idx] = { ...prev[idx], ...row } as HomeBroadcast;
            return next;
          });
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [uid]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#e63946"
          />
        }
      >
        <Text style={styles.title}>LIVE SPOtCH</Text>

        {/* (a) 共有コードで視聴 */}
        <Text style={styles.sectionTitle}>共有コードで試合を見る</Text>
        <View style={styles.codeRow}>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(t) => setCode(normalizeCode(t))}
            placeholder="共有コードを入力（例: ABC123XY）"
            placeholderTextColor="#666"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={SHARE_CHARS_MAX}
            onSubmitEditing={() => openWatch(code)}
            returnKeyType="go"
          />
          <Pressable
            style={[styles.watchBtn, !code.trim() && styles.watchBtnDisabled]}
            disabled={!code.trim()}
            onPress={() => openWatch(code)}
          >
            <Text
              style={[styles.watchBtnText, !code.trim() && styles.watchBtnTextDisabled]}
            >
              視聴
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          配信者から共有されたコードまたはURLで視聴できます
        </Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#e63946" />
          </View>
        ) : !uid ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              ログインすると、あなたが配信した試合や所属チームの試合が表示されます。
            </Text>
            <Text style={styles.emptySub}>
              共有コードをお持ちの場合は、上のフォームから視聴できます（ログイン不要）。
            </Text>
          </View>
        ) : (
          <>
            {/* (b) あなたに関係する配信（LIVE中） */}
            <View style={styles.liveHeader}>
              <View style={styles.liveDot} />
              <Text style={styles.sectionTitle}>あなたに関係する配信（LIVE中）</Text>
            </View>
            {live.length > 0 ? (
              live.map((b) => (
                <Pressable
                  key={b.id}
                  style={styles.liveCard}
                  onPress={() => openWatch(b.share_code)}
                >
                  <View style={styles.liveTopRow}>
                    <View style={styles.liveTeamWrap}>
                      <Text style={styles.liveTeams} numberOfLines={1}>
                        {sportEmoji(b.sport)} {b.home_team} vs {b.away_team}
                      </Text>
                      {b.tournament ? (
                        <Text style={styles.liveTournament} numberOfLines={1}>
                          {b.tournament}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.liveBadge}>
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                    {/* 通報・ブロック（Guideline 1.2）。カードのタップ(視聴)とは独立。 */}
                    <Pressable
                      style={styles.reportBtn}
                      hitSlop={8}
                      onPress={() =>
                        setModTarget({
                          broadcastId: b.id,
                          broadcasterId: b.broadcaster_id,
                          shareCode: b.share_code,
                          label: `${b.home_team} vs ${b.away_team}`,
                        })
                      }
                    >
                      <Text style={styles.reportBtnText}>⋯</Text>
                    </Pressable>
                  </View>
                  <View style={styles.liveBottomRow}>
                    <Text style={styles.liveScore}>
                      {b.home_score} <Text style={styles.liveDash}>-</Text>{" "}
                      {b.away_score}
                    </Text>
                    <View style={styles.liveMetaWrap}>
                      <Text style={styles.liveMeta}>{b.period}</Text>
                      {b.point_label ? (
                        <View style={styles.pointBadge}>
                          <Text style={styles.pointBadgeText}>{b.point_label}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.watchLink}>視聴する →</Text>
                    </View>
                  </View>
                </Pressable>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>現在 LIVE 中の試合はありません</Text>
                <Text style={styles.emptySub}>
                  あなた・所属チームの配信が始まるとここに表示されます
                </Text>
              </View>
            )}

            {/* (d) 次の予定（閲覧のみ） */}
            <Text style={[styles.sectionTitle, styles.sectionGap]}>次の予定</Text>
            {schedules.length > 0 ? (
              schedules.slice(0, 8).map((s) => {
                const teamName = teams.find((t) => t.id === s.team_id)?.name ?? "";
                return (
                  <View key={s.id} style={styles.scheduleCard}>
                    <Text style={styles.scheduleTime}>{formatScheduleTime(s.start_at)}</Text>
                    <Text style={styles.scheduleMatch} numberOfLines={1}>
                      {sportEmoji(s.sport)} {s.home_team} vs {s.away_team}
                    </Text>
                    <View style={styles.scheduleMetaRow}>
                      {teamName ? (
                        <Text style={styles.scheduleMeta} numberOfLines={1}>
                          {teamName}
                        </Text>
                      ) : null}
                      {s.location ? (
                        <Text style={styles.scheduleMeta} numberOfLines={1}>
                          📍 {s.location}
                        </Text>
                      ) : null}
                    </View>
                    {s.tournament ? (
                      <Text style={styles.scheduleMeta} numberOfLines={1}>
                        {s.tournament}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>登録された予定はまだありません</Text>
                <Text style={styles.emptySub}>
                  チームのオーナー・管理者が予定を追加するとここに表示されます
                </Text>
              </View>
            )}
            {schedules.length > 8 ? (
              <Text style={styles.moreNote}>
                ほかに {schedules.length - 8} 件の予定があります
              </Text>
            ) : null}

            {/* (c) あなたのチーム */}
            {teams.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, styles.sectionGap]}>
                  あなたのチーム {teams.length} 件
                </Text>
                <View style={styles.teamWrap}>
                  {teams.map((t) => (
                    <View key={t.id} style={styles.teamChip}>
                      <Text style={styles.teamChipText}>
                        {sportEmoji(t.sport)} {t.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* 通報・ブロックメニュー（Guideline 1.2） */}
      <ModerationMenu
        visible={modTarget !== null}
        target={modTarget}
        currentUserId={uid}
        onClose={() => setModTarget(null)}
        onBlocked={(blockedId) => {
          setBlockedIds((prev) =>
            prev.includes(blockedId) ? prev : [...prev, blockedId],
          );
          setLive((prev) => prev.filter((b) => b.broadcaster_id !== blockedId));
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 16 },

  sectionTitle: { color: "#ddd", fontSize: 15, fontWeight: "700" },
  sectionGap: { marginTop: 28 },

  // 通報・ブロック トリガー（カード右上）
  reportBtn: { paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  reportBtnText: { color: "#888", fontSize: 18, fontWeight: "800", lineHeight: 18 },

  // 共有コード入力
  codeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  codeInput: {
    flex: 1,
    backgroundColor: "#111",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    letterSpacing: 3,
    borderWidth: 1,
    borderColor: "#333",
  },
  watchBtn: {
    backgroundColor: "#e63946",
    borderRadius: 8,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  watchBtnDisabled: { backgroundColor: "#1a1a1a" },
  watchBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  watchBtnTextDisabled: { color: "#666" },
  hint: { color: "#777", fontSize: 12, marginTop: 8 },

  loadingBox: { paddingVertical: 36, alignItems: "center" },

  // LIVE セクション
  liveHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 28,
    marginBottom: 10,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#e63946" },
  liveCard: {
    backgroundColor: "#111",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    marginBottom: 10,
  },
  liveTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  liveTeamWrap: { flex: 1, minWidth: 0 },
  liveTeams: { color: "#fff", fontSize: 14, fontWeight: "700" },
  liveTournament: { color: "#888", fontSize: 11, marginTop: 2 },
  liveBadge: {
    backgroundColor: "#e63946",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  liveBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  liveBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  liveScore: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  liveDash: { color: "#666", fontSize: 15 },
  liveMetaWrap: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  liveMeta: { color: "#999", fontSize: 12 },
  pointBadge: {
    backgroundColor: "#f4a300",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pointBadgeText: { color: "#1a1a1a", fontSize: 10, fontWeight: "800" },
  watchLink: { color: "#e63946", fontSize: 12, fontWeight: "700" },

  // 予定
  scheduleCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#262626",
  },
  scheduleTime: { color: "#e63946", fontSize: 13, fontWeight: "700" },
  scheduleMatch: { color: "#fff", fontSize: 14, fontWeight: "600", marginTop: 4 },
  scheduleMetaRow: { flexDirection: "row", gap: 12, marginTop: 4, flexWrap: "wrap" },
  scheduleMeta: { color: "#999", fontSize: 12 },
  moreNote: { color: "#777", fontSize: 11, marginTop: 8 },

  // チーム
  teamWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  teamChip: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  teamChipText: { color: "#ccc", fontSize: 13, fontWeight: "600" },

  // 空状態カード
  emptyCard: {
    backgroundColor: "#111",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 18,
    marginTop: 10,
    alignItems: "center",
  },
  emptyText: { color: "#aaa", fontSize: 14, textAlign: "center" },
  emptySub: { color: "#777", fontSize: 12, textAlign: "center", marginTop: 6, lineHeight: 17 },
});
