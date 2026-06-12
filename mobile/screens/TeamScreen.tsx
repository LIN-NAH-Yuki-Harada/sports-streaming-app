import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { SITE_URL } from "../config";
import {
  type FullTeam,
  TEAM_SPORTS,
  ROLE_LABELS,
  teamSportEmoji,
  fetchMyFullTeams,
  createTeam,
  joinTeamByCode,
} from "../lib/team-data";

// チームタブ。画面内サブタブ（ローカル state）で
//   マイチーム / 招待コードで参加 / 新規作成 を切り替える。
// バックエンドは Web と同一（GET/POST /api/teams・POST /api/teams/join）。
// 視聴は当面 Web のまま：${SITE_URL}/watch/<share_code> を外部ブラウザで開く。
// メンバー管理/設定など高度な機能は v2。

type SubTab = "list" | "join" | "create";

export function TeamScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("list");

  // マイチーム一覧
  const [teams, setTeams] = useState<FullTeam[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [selected, setSelected] = useState<FullTeam | null>(null);

  // 参加フォーム
  const [joinCode, setJoinCode] = useState("");

  // 作成フォーム
  const [name, setName] = useState("");
  const [sport, setSport] = useState("サッカー");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // セッションからユーザー ID を取得（自分のロール表示判定に使う）
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  const loadTeams = useCallback(async () => {
    setLoadingTeams(true);
    try {
      const list = await fetchMyFullTeams();
      setTeams(list);
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // 招待コードで参加
  const handleJoin = useCallback(async () => {
    if (!joinCode.trim()) return;
    setSubmitting(true);
    setMessage(null);
    const r = await joinTeamByCode(joinCode);
    setSubmitting(false);
    if (r.error) {
      setMessage(r.error);
      return;
    }
    if (r.alreadyMember) {
      setMessage(`「${r.team?.name}」には既に参加しています。`);
    } else {
      setMessage(`「${r.team?.name}」に参加しました！`);
    }
    setJoinCode("");
    await loadTeams();
    setSubTab("list");
  }, [joinCode, loadTeams]);

  // チーム新規作成（チームプラン限定・サーバーがプランを判定）
  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setMessage(null);
    const r = await createTeam({
      name: name.trim(),
      sport,
      description: description.trim(),
    });
    setSubmitting(false);
    if (r.error) {
      setMessage(r.error);
      return;
    }
    setMessage(`「${r.team?.name}」を作成しました！`);
    setName("");
    setDescription("");
    setSport("サッカー");
    await loadTeams();
    setSubTab("list");
  }, [name, sport, description, loadTeams]);

  // 簡易詳細画面（チーム名・競技・自分の招待コード）
  if (selected) {
    return (
      <TeamDetail
        team={selected}
        userId={userId}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>チーム</Text>

        {/* サブタブ切替 */}
        <View style={styles.tabRow}>
          {(
            [
              { key: "list", label: "マイチーム" },
              { key: "join", label: "招待コードで参加" },
              { key: "create", label: "新規作成" },
            ] as { key: SubTab; label: string }[]
          ).map((t) => {
            const active = subTab === t.key;
            return (
              <Pressable
                key={t.key}
                style={[styles.tabChip, active && styles.tabChipActive]}
                onPress={() => {
                  setSubTab(t.key);
                  setMessage(null);
                }}
              >
                <Text
                  style={[styles.tabChipText, active && styles.tabChipTextActive]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}

        {/* マイチーム一覧 */}
        {subTab === "list" && (
          <View style={styles.section}>
            {loadingTeams ? (
              <View style={styles.center}>
                <ActivityIndicator color="#e63946" />
                <Text style={styles.dim}>読み込み中...</Text>
              </View>
            ) : teams.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>まだチームがありません</Text>
                <Text style={styles.emptyNote}>
                  招待コードで参加するか、{"\n"}
                  チームプランで新規作成できます。
                </Text>
                <Pressable
                  style={styles.outlineBtn}
                  onPress={() => setSubTab("join")}
                >
                  <Text style={styles.outlineBtnText}>招待コードで参加</Text>
                </Pressable>
              </View>
            ) : (
              teams.map((team) => {
                const myRole =
                  team.team_members.find((m) => m.user_id === userId)?.role ??
                  "member";
                return (
                  <Pressable
                    key={team.id}
                    style={styles.teamRow}
                    onPress={() => setSelected(team)}
                  >
                    <View style={styles.teamAvatar}>
                      <Text style={styles.teamEmoji}>
                        {teamSportEmoji(team.sport)}
                      </Text>
                    </View>
                    <View style={styles.teamInfo}>
                      <Text style={styles.teamName} numberOfLines={1}>
                        {team.name}
                      </Text>
                      <Text style={styles.teamMeta}>
                        {team.sport} / {team.team_members.length}人 /{" "}
                        {ROLE_LABELS[myRole]}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {/* 招待コードで参加 */}
        {subTab === "join" && (
          <View style={styles.section}>
            <Text style={styles.help}>
              チームの管理者から共有された招待コードを入力してください。
            </Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              placeholder="例: ABCD1234"
              placeholderTextColor="#666"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
            />
            <Pressable
              style={[
                styles.button,
                (submitting || !joinCode.trim()) && styles.buttonDisabled,
              ]}
              onPress={handleJoin}
              disabled={submitting || !joinCode.trim()}
            >
              <Text style={styles.buttonText}>
                {submitting ? "参加中..." : "参加する"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* チーム新規作成 */}
        {subTab === "create" && (
          <View style={styles.section}>
            <Text style={styles.help}>
              チームの作成はチームプランの特典です。
            </Text>

            <Text style={styles.label}>チーム名 *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="例: 港FC"
              placeholderTextColor="#666"
            />

            <Text style={styles.label}>競技 *</Text>
            <View style={styles.sportRow}>
              {TEAM_SPORTS.map((s) => {
                const active = s.value === sport;
                return (
                  <Pressable
                    key={s.value}
                    style={[styles.sportChip, active && styles.sportChipActive]}
                    onPress={() => setSport(s.value)}
                  >
                    <Text
                      style={[
                        styles.sportChipText,
                        active && styles.sportChipTextActive,
                      ]}
                    >
                      {s.emoji} {s.value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>説明（任意）</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="例: 港区の小学生サッカーチームです"
              placeholderTextColor="#666"
              multiline
            />

            <Pressable
              style={[
                styles.button,
                (submitting || !name.trim()) && styles.buttonDisabled,
              ]}
              onPress={handleCreate}
              disabled={submitting || !name.trim()}
            >
              <Text style={styles.buttonText}>
                {submitting ? "作成中..." : "チームを作成"}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ===== 簡易チーム詳細（チーム名・競技・招待コード・メンバー一覧）=====
function TeamDetail({
  team,
  userId,
  onBack,
}: {
  team: FullTeam;
  userId: string | null;
  onBack: () => void;
}) {
  const myMembership = team.team_members.find((m) => m.user_id === userId);
  const canInvite =
    myMembership?.role === "owner" || myMembership?.role === "admin";
  const inviteCode = team.invite_code;

  // 招待コードを LINE 等で共有（Web の招待メッセージ文面に準拠）
  const shareInvite = useCallback(async () => {
    if (!inviteCode) return;
    const inviteUrl = `${SITE_URL}/search?invite=${inviteCode}`;
    const msg =
      `🏆 「${team.name}」のチームに招待します！\n\n` +
      `下記のリンクを開くと、招待コードが自動で入力されます 👇\n${inviteUrl}\n\n` +
      `（招待コード: ${inviteCode}）\n\n— LIVE SPOtCH\n${SITE_URL}`;
    try {
      await Share.share({ message: msg });
    } catch {
      // 共有シートを閉じただけ等は無視
    }
  }, [inviteCode, team.name]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backText}>← チーム一覧</Text>
        </Pressable>

        {/* チーム情報ヘッダー */}
        <View style={styles.detailHeader}>
          <View style={styles.detailAvatar}>
            <Text style={styles.detailEmoji}>{teamSportEmoji(team.sport)}</Text>
          </View>
          <View style={styles.teamInfo}>
            <Text style={styles.detailName} numberOfLines={2}>
              {team.name}
            </Text>
            <Text style={styles.teamMeta}>
              {team.sport} / メンバー {team.team_members.length}人
            </Text>
          </View>
        </View>
        {team.description ? (
          <Text style={styles.detailDesc}>{team.description}</Text>
        ) : null}

        {/* 招待コード（owner/admin のみ）*/}
        {canInvite && inviteCode ? (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteLabel}>招待コード</Text>
            <Text style={styles.inviteCode}>{inviteCode}</Text>
            <Text style={styles.inviteHint}>
              このコードをメンバーに伝えると、チームに参加できます。
            </Text>
            <Pressable style={styles.shareBtn} onPress={shareInvite}>
              <Text style={styles.shareBtnText}>📲 招待を共有</Text>
            </Pressable>
          </View>
        ) : null}

        {/* メンバー一覧（参照のみ・管理は v2）*/}
        <Text style={styles.label}>メンバー</Text>
        <View style={styles.section}>
          {[...team.team_members]
            .sort((a, b) => {
              const order = { owner: 0, admin: 1, member: 2 };
              return order[a.role] - order[b.role];
            })
            .map((m) => {
              const dn = m.profiles?.display_name || "名前未設定";
              const isMe = m.user_id === userId;
              return (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberInitial}>{dn[0]}</Text>
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {dn}
                    {isMe ? "（自分）" : ""}
                  </Text>
                  <Text style={styles.memberRole}>{ROLE_LABELS[m.role]}</Text>
                </View>
              );
            })}
        </View>

        <Pressable
          style={styles.outlineBtn}
          onPress={() => {
            // 試合視聴は当面 Web。チームの試合一覧は Web のチームページで確認。
            Linking.openURL(`${SITE_URL}/search`).catch(() => {
              Alert.alert("ページを開けませんでした");
            });
          }}
        >
          <Text style={styles.outlineBtnText}>
            試合履歴・予定はWebで見る
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { padding: 20, paddingBottom: 48 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 16 },

  // サブタブ
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  tabChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
  },
  tabChipActive: { backgroundColor: "rgba(255,255,255,0.1)", borderColor: "#555" },
  tabChipText: { color: "#888", fontSize: 13, fontWeight: "600" },
  tabChipTextActive: { color: "#fff" },

  section: { gap: 10, marginTop: 4 },
  message: { color: "#8fd6a0", fontSize: 13, marginBottom: 8 },
  help: { color: "#bbb", fontSize: 13, lineHeight: 19, marginBottom: 4 },
  dim: { color: "#888", fontSize: 13 },
  label: { color: "#bbb", fontSize: 13, marginTop: 8 },

  input: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  codeInput: { fontSize: 18, letterSpacing: 4, fontWeight: "700", textAlign: "center" },
  textArea: { minHeight: 64, textAlignVertical: "top" },

  button: {
    backgroundColor: "#e63946",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  outlineBtn: {
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginTop: 16,
  },
  outlineBtnText: { color: "#ddd", fontSize: 14, fontWeight: "600" },

  // 空状態
  empty: { alignItems: "center", paddingVertical: 32, gap: 6 },
  emptyTitle: { color: "#ccc", fontSize: 15, fontWeight: "700" },
  emptyNote: { color: "#888", fontSize: 12, textAlign: "center", lineHeight: 18 },

  // チーム行
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "#1a1a1a",
    borderRadius: 10,
    padding: 12,
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(230,57,70,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  teamEmoji: { fontSize: 20 },
  teamInfo: { flex: 1, minWidth: 0 },
  teamName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  teamMeta: { color: "#888", fontSize: 12, marginTop: 2 },
  chevron: { color: "#666", fontSize: 22, fontWeight: "700" },

  // 競技プルダウン代替（チップ）
  sportRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sportChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#444",
    backgroundColor: "#1a1a1a",
  },
  sportChipActive: { backgroundColor: "#e63946", borderColor: "#e63946" },
  sportChipText: { color: "#ccc", fontSize: 13, fontWeight: "600" },
  sportChipTextActive: { color: "#fff" },

  // 詳細
  backBtn: { paddingVertical: 4, marginBottom: 8 },
  backText: { color: "#888", fontSize: 14, fontWeight: "600" },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  detailAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(230,57,70,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  detailEmoji: { fontSize: 22 },
  detailName: { color: "#fff", fontSize: 18, fontWeight: "800" },
  detailDesc: { color: "#bbb", fontSize: 13, marginTop: 12, lineHeight: 19 },

  inviteCard: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    gap: 6,
  },
  inviteLabel: { color: "#888", fontSize: 11 },
  inviteCode: {
    color: "#e63946",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 4,
  },
  inviteHint: { color: "#888", fontSize: 11, lineHeight: 16 },
  shareBtn: {
    backgroundColor: "#1d9bf0",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 6,
  },
  shareBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  // メンバー
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "#1a1a1a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  memberInitial: { color: "#fff", fontSize: 13, fontWeight: "700" },
  memberName: { flex: 1, color: "#fff", fontSize: 13 },
  memberRole: { color: "#888", fontSize: 11 },
});
