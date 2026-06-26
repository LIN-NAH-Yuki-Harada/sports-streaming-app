import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { type MyTeam } from "../lib/teams";
import {
  type HistoryBroadcast,
  type HistoryGroup,
  fetchMyHistory,
  fetchTeamHistory,
  fetchMyTeamsForHistory,
  groupByDate,
  sportEmoji,
  timeLabel,
  youtubeWatchUrl,
} from "../lib/history-data";
import { fetchBlockedIds } from "../lib/moderation";
import {
  ModerationMenu,
  type ModerationTarget,
} from "../components/ModerationMenu";

// 配信履歴タブ。過去の配信（status=ended）を日付グループで一覧表示する。
// ・self  = 自分が配信したもの（broadcaster_id=自分）
// ・チーム = 所属チームの配信（team_id=そのチーム）
// 視聴は当面 Web（live-spotch.com/watch/<code>）に飛ばす。YouTube アーカイブがあれば
// YouTube 視聴リンクも出す。Web 版（schedule/page.tsx）の見た目・挙動に揃える。

// フィルタ: "self" = 自分の配信 / それ以外 = team_id
type HistoryFilter = "self" | string;

export function HistoryScreen() {
  const [filter, setFilter] = useState<HistoryFilter>("self");
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [groups, setGroups] = useState<HistoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [modTarget, setModTarget] = useState<ModerationTarget | null>(null);

  // 所属チーム一覧（フィルタチップ用）を初回取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      const teams = await fetchMyTeamsForHistory(uid);
      if (!cancelled) setMyTeams(teams);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // フィルタ切替（または初回）で履歴を取得し直す
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id ?? null;
      if (cancelled) return;
      setUid(userId);
      if (!userId) {
        setGroups([]);
        setCount(0);
        setLoading(false);
        return;
      }
      const [items, blocked] = await Promise.all([
        filter === "self" ? fetchMyHistory(userId) : fetchTeamHistory(filter),
        fetchBlockedIds(userId),
      ]);
      if (cancelled) return;
      // ブロック済み配信者の履歴は表示しない（Guideline 1.2 のフィルタ）。
      const visible = items.filter((bc) => !blocked.includes(bc.broadcaster_id));
      setGroups(groupByDate(visible));
      setCount(visible.length);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>配信履歴</Text>

      {/* 所属チームがあるときだけフィルタチップを表示（個人ユーザーには出さない） */}
      {myTeams.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterRow}
        >
          <FilterChip
            label="自分の配信"
            active={filter === "self"}
            onPress={() => setFilter("self")}
          />
          {myTeams.map((t) => (
            <FilterChip
              key={t.id}
              label={`👥 ${t.name}`}
              active={filter === t.id}
              onPress={() => setFilter(t.id)}
            />
          ))}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#e63946" />
        </View>
      ) : count === 0 ? (
        <EmptyState isTeamFilter={filter !== "self"} />
      ) : (
        <ScrollView style={styles.listScroll} contentContainerStyle={styles.scroll}>
          {groups.map((group) => (
            <View key={group.date} style={styles.group}>
              <Text style={styles.groupDate}>{group.date}</Text>
              {group.items.map((bc) => (
                <HistoryCard
                  key={bc.id}
                  bc={bc}
                  onReport={() =>
                    setModTarget({
                      broadcastId: bc.id,
                      broadcasterId: bc.broadcaster_id,
                      shareCode: bc.share_code,
                      label: `${bc.home_team} vs ${bc.away_team}`,
                    })
                  }
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* 通報・ブロックメニュー（Guideline 1.2） */}
      <ModerationMenu
        visible={modTarget !== null}
        target={modTarget}
        currentUserId={uid}
        onClose={() => setModTarget(null)}
        onBlocked={(blockedId) => {
          // ブロックした配信者の履歴を即時に一覧から除く。
          setGroups((prev) =>
            prev
              .map((g) => ({
                ...g,
                items: g.items.filter((b) => b.broadcaster_id !== blockedId),
              }))
              .filter((g) => g.items.length > 0),
          );
        }}
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ isTeamFilter }: { isTeamFilter: boolean }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>🕐</Text>
      <Text style={styles.emptyTitle}>
        {isTeamFilter ? "このチームの配信履歴はまだありません" : "まだ配信履歴がありません"}
      </Text>
      <Text style={styles.emptyNote}>
        {isTeamFilter
          ? "チームメンバーが配信するとここに表示されます"
          : "配信を行うとここに履歴が表示されます"}
      </Text>
    </View>
  );
}

function HistoryCard({
  bc,
  onReport,
}: {
  bc: HistoryBroadcast;
  onReport: () => void;
}) {
  // セットありの競技（バレー等）はセット数を、それ以外は得点を表示
  const setBased = bc.home_sets > 0 || bc.away_sets > 0;
  const ytUrl = youtubeWatchUrl(bc);

  // アーカイブ視聴は YouTube（限定公開）のみ。終了済み配信の自社プレイヤー(Web)は
  // 実体が無く再生できないため「Webで見る」は廃止（オーナー指示 2026-06-12）。
  const openYouTube = useCallback(() => {
    if (ytUrl) Linking.openURL(ytUrl).catch(() => {});
  }, [ytUrl]);

  // バレー等のセット制で、各セットの最終得点が取れていれば内訳を表示する。
  const showSetBreakdown = setBased && bc.set_results.length > 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardInfo}>
          <View style={styles.teamRow}>
            <Text style={styles.sportEmoji}>{sportEmoji(bc.sport)}</Text>
            <Text style={styles.teamName} numberOfLines={1}>
              {bc.home_team} vs {bc.away_team}
            </Text>
          </View>
          <View style={styles.metaRow}>
            {bc.tournament ? (
              <Text style={styles.tournament} numberOfLines={1}>
                {bc.tournament}
              </Text>
            ) : null}
            <Text style={styles.time}>{timeLabel(bc.started_at)}</Text>
          </View>
        </View>

        {/* スコア表示:
            ・セット制でセット内訳がある → [取得セット数] [各セットの得点を縦並び] [取得セット数]
            ・セット制で内訳なし → セット数のみ（黄色）
            ・それ以外 → 得点 */}
        {showSetBreakdown ? (
          <View style={styles.setScoreBox}>
            <Text style={styles.setWinNum}>{bc.home_sets}</Text>
            <View style={styles.setList}>
              {bc.set_results.map((s, i) => (
                <Text key={i} style={styles.setLine}>
                  {s.home}-{s.away}
                </Text>
              ))}
            </View>
            <Text style={styles.setWinNum}>{bc.away_sets}</Text>
          </View>
        ) : (
          <View style={styles.scoreBox}>
            <Text style={[styles.scoreNum, setBased && styles.setNum]}>
              {setBased ? bc.home_sets : bc.home_score}
            </Text>
            <Text style={styles.scoreDash}>-</Text>
            <Text style={[styles.scoreNum, setBased && styles.setNum]}>
              {setBased ? bc.away_sets : bc.away_score}
            </Text>
          </View>
        )}
      </View>

      {/* アクション: YouTube アーカイブ（あれば）＋ 通報・ブロック */}
      <View style={styles.actions}>
        {ytUrl ? (
          <Pressable style={styles.ytBtn} onPress={openYouTube}>
            <Text style={styles.ytText}>YouTubeで見る（限定公開）</Text>
          </Pressable>
        ) : (
          <Text style={styles.noArchive}>アーカイブなし</Text>
        )}
        {/* 通報・ブロック（Guideline 1.2） */}
        <Pressable style={styles.reportBtn} hitSlop={8} onPress={onReport}>
          <Text style={styles.reportBtnText}>⋯</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  reportBtn: {
    marginLeft: "auto",
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignSelf: "center",
  },
  reportBtnText: { color: "#777", fontSize: 18, fontWeight: "800", lineHeight: 18 },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  listScroll: { flex: 1 },

  filterScroll: { flexGrow: 0 },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: "#1a1a1a",
  },
  chipActive: { backgroundColor: "#e63946", borderColor: "#e63946" },
  chipText: { color: "#bbb", fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },

  group: { marginTop: 18 },
  groupDate: { color: "#888", fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },

  card: {
    backgroundColor: "#111",
    borderColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardInfo: { flex: 1, minWidth: 0, paddingRight: 10 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sportEmoji: { fontSize: 14 },
  teamName: { color: "#fff", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  tournament: { color: "#888", fontSize: 12, flexShrink: 1 },
  time: { color: "#666", fontSize: 12 },

  scoreBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scoreNum: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    minWidth: 16,
    textAlign: "center",
  },
  setNum: { color: "#ffd24a" },
  scoreDash: { color: "#666", fontSize: 12 },

  // セット内訳: [勝セット数] [各セット得点を縦並び] [勝セット数]
  setScoreBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  setWinNum: {
    color: "#ffd24a",
    fontSize: 22,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    minWidth: 18,
    textAlign: "center",
  },
  setList: { alignItems: "center" },
  setLine: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    lineHeight: 18,
  },
  noArchive: { color: "#666", fontSize: 12 },

  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  ytBtn: {
    backgroundColor: "rgba(230,57,70,0.12)",
    borderColor: "#e63946",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ytText: { color: "#e63946", fontSize: 12, fontWeight: "700" },

  emoji: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { color: "#aaa", fontSize: 14, fontWeight: "600", textAlign: "center" },
  emptyNote: { color: "#666", fontSize: 12, textAlign: "center", marginTop: 6, lineHeight: 18 },
});
