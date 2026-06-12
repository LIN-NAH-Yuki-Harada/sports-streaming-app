import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { SITE_URL } from "../config";
import {
  type MyProfile,
  fetchMyProfile,
  PLAN_LABELS,
} from "../lib/mypage-data";

// マイページ（配信専用ネイティブアプリ）。
// プロフィール / 現在のプラン / YouTube 連携状態 を「表示」する。
// ★ プラン変更・YouTube 連携/解除・退会の「実操作」はアプリ内に持たず Web へ誘導する
//   （Apple のアプリ内課金ポリシー回避のため、アプリ内に課金 UI を置かない方針）。
// ログアウトのみアプリ内で完結（supabase.auth.signOut）。

const APP_VERSION = "1.0.0";

export function MyPageScreen() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);

  // セッション（email）＋ プロフィール（plan / 表示名 / YouTube連携）を読み込む。
  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setEmail(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    setEmail(session.user.email ?? null);
    const p = await fetchMyProfile(session.user.id);
    setProfile(p);
    setLoading(false);
  }, []);

  // タブを開く / 戻ってくるたびに最新化（Web で課金・連携した結果を反映するため）。
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load().finally(() => {
        if (cancelled) return;
      });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const openWeb = useCallback((path: string) => {
    Linking.openURL(`${SITE_URL}${path}`).catch(() => {});
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert("ログアウトしますか？", undefined, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: () => {
          supabase.auth.signOut().catch(() => {});
        },
      },
    ]);
  }, []);

  // 退会は不可逆かつ決済解約も伴うため、アプリ内では確認のうえ Web のマイページへ誘導する。
  const handleDelete = useCallback(() => {
    Alert.alert(
      "アカウントを削除（退会）",
      "退会手続きはWebのマイページからAdministratorが行います。ブラウザを開きますか？",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "Webで手続き",
          style: "destructive",
          onPress: () => openWeb("/mypage"),
        },
      ],
    );
  }, [openWeb]);

  // プラン表示名（取得前は無料プラン表記をプレースホルダに）
  const planLabel = PLAN_LABELS[profile?.plan ?? "free"];
  const displayName = profile?.display_name || email || "ユーザー";
  const initial = (profile?.display_name || email || "U")
    .charAt(0)
    .toUpperCase();
  const youtubeLinked = Boolean(profile?.youtube_channel_id);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>マイページ</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#e63946" />
          </View>
        ) : (
          <>
            {/* プロフィール: アバター（頭文字）＋ 表示名 ＋ メール ＋ プラン */}
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View style={styles.profileMeta}>
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>
                {email ? (
                  <Text style={styles.email} numberOfLines={1}>
                    {email}
                  </Text>
                ) : null}
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>{planLabel}</Text>
                </View>
              </View>
            </View>

            {/* 現在のプラン（表示のみ）。変更・解約は Web へ。 */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>現在のプラン</Text>
              <Text style={styles.cardValue}>{planLabel}</Text>
              {profile?.subscription_status ? (
                <Text style={styles.cardSub}>
                  ステータス: {profile.subscription_status}
                </Text>
              ) : null}
              <Text style={styles.cardNote}>
                プランの変更・解約・お支払いはWebのマイページから行えます。
              </Text>
              <Pressable
                style={styles.webButton}
                onPress={() => openWeb("/mypage")}
              >
                <Text style={styles.webButtonText}>
                  {profile?.plan === "free"
                    ? "プランを選ぶ（Webへ）"
                    : "プラン管理（Webへ）"}
                </Text>
              </Pressable>
            </View>

            {/* YouTube 連携（状態表示のみ。連携/解除は Web へ） */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardLabel}>YouTube連携</Text>
                <View
                  style={[
                    styles.statusPill,
                    youtubeLinked
                      ? styles.statusPillOn
                      : styles.statusPillOff,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      youtubeLinked
                        ? styles.statusPillTextOn
                        : styles.statusPillTextOff,
                    ]}
                  >
                    {youtubeLinked ? "連携中" : "未連携"}
                  </Text>
                </View>
              </View>
              {youtubeLinked ? (
                <Text style={styles.cardValue} numberOfLines={1}>
                  {profile?.youtube_channel_name || "（チャンネル名なし）"}
                </Text>
              ) : (
                <Text style={styles.cardSub}>
                  チームプラン特典。配信のYouTube同時配信・自動アーカイブに使います。
                </Text>
              )}
              {youtubeLinked ? (
                <Text style={styles.cardNote}>
                  YouTube同時配信: {profile?.youtube_live_enabled ? "ON" : "OFF"}
                </Text>
              ) : null}
              <Text style={styles.cardNote}>
                連携・解除・同時配信のON/OFFはWebのマイページから設定できます。
              </Text>
              <Pressable
                style={styles.webButtonGhost}
                onPress={() => openWeb("/mypage")}
              >
                <Text style={styles.webButtonGhostText}>
                  {youtubeLinked
                    ? "連携設定を見る（Webへ）"
                    : "YouTubeと連携する（Webへ）"}
                </Text>
              </Pressable>
            </View>

            {/* チーム管理 → チームタブ案内 ＋ Web 誘導 */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>チーム管理</Text>
              <Text style={styles.cardSub}>
                所属チームの確認・配信は「チーム」タブから。チームの作成・メンバー管理はWebが便利です。
              </Text>
              <Pressable
                style={styles.webButtonGhost}
                onPress={() => openWeb("/search")}
              >
                <Text style={styles.webButtonGhostText}>
                  チーム管理（Webへ）
                </Text>
              </Pressable>
            </View>

            {/* お問い合わせ（Web） */}
            <Pressable
              style={styles.linkRow}
              onPress={() => openWeb("/contact")}
            >
              <Text style={styles.linkRowText}>お問い合わせ</Text>
              <Text style={styles.linkRowArrow}>→</Text>
            </Pressable>

            {/* ログアウト（アプリ内で完結） */}
            <Pressable style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>ログアウト</Text>
            </Pressable>

            {/* アカウント削除（退会）→ Web 誘導 */}
            <Pressable style={styles.deleteButton} onPress={handleDelete}>
              <Text style={styles.deleteText}>アカウントを削除（退会）</Text>
            </Pressable>
          </>
        )}

        <Text style={styles.version}>LIVE SPOtCH v{APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { padding: 20, paddingBottom: 40 },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 20,
  },
  center: { paddingVertical: 60, alignItems: "center" },

  profileRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#e63946", fontSize: 24, fontWeight: "800" },
  profileMeta: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: "#fff", fontSize: 17, fontWeight: "700" },
  email: { color: "#888", fontSize: 12 },
  planBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(230,57,70,0.12)",
    borderColor: "rgba(230,57,70,0.4)",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  planBadgeText: { color: "#e63946", fontSize: 11, fontWeight: "700" },

  card: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    gap: 4,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLabel: { color: "#bbb", fontSize: 12, fontWeight: "600" },
  cardValue: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 2 },
  cardSub: { color: "#999", fontSize: 12, lineHeight: 18, marginTop: 2 },
  cardNote: { color: "#666", fontSize: 11, lineHeight: 16, marginTop: 6 },

  statusPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusPillOn: {
    backgroundColor: "rgba(143,214,160,0.12)",
    borderColor: "rgba(143,214,160,0.4)",
  },
  statusPillOff: { backgroundColor: "#1a1a1a", borderColor: "#333" },
  statusPillText: { fontSize: 11, fontWeight: "700" },
  statusPillTextOn: { color: "#8fd6a0" },
  statusPillTextOff: { color: "#888" },

  webButton: {
    backgroundColor: "#e63946",
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
    marginTop: 12,
  },
  webButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  webButtonGhost: {
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  webButtonGhostText: { color: "#ddd", fontSize: 13, fontWeight: "600" },

  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    marginTop: 2,
  },
  linkRowText: { color: "#fff", fontSize: 14 },
  linkRowArrow: { color: "#666", fontSize: 14 },

  logoutButton: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 24,
  },
  logoutText: { color: "#bbb", fontSize: 15, fontWeight: "700" },
  deleteButton: { paddingVertical: 14, alignItems: "center", marginTop: 6 },
  deleteText: { color: "#777", fontSize: 12 },

  version: { color: "#555", fontSize: 11, textAlign: "center", marginTop: 28 },
});
