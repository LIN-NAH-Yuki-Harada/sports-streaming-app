import { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { updateDisplayName } from "../lib/mypage-data";

// ============================================================================
// 表示名の入力を強制するゲート（Web 版 name-setup-modal.tsx のアプリ移植）。
//
// なぜ必要か:
//   Web には display_name が空だと全画面を塞ぐ NameSetupModal があるが、
//   アプリには「名前を入れてください」と促す導線が一つも無かった。
//   アプリは display_name が空でもメールアドレスを代わりに表示する（MyPage）ため
//   ユーザーは不具合と気づかず、問い合わせも来ないまま静かに増える。
//   実測: 空の割合が 4月 0% → 6月 2.3% → 7月 37% → 8月 50%（iOS版ローンチ=7/09）。
//
// ★なぜ <Modal> を使わないのか（重要）:
//   App.tsx の content 差し替えとして描画する。<Modal> にすると
//     ・supportedOrientations 既定 ["portrait"] で横持ちが壊れる
//     ・Android のハードウェア戻るボタン1回で**ゲートを回避できてしまう**
//     ・Android 横持ちで adjustResize が効かずキーボードがボタンを覆う
//   の3つを自前で塞ぐ必要がある。content 差し替えなら**そもそも
//   ナビゲーションが存在しない**ので、回避不能が構造的に保証される。
//
// ★Android の戻るボタンは意図的に握らない:
//   ルートで戻るとアプリが背景に落ちるだけで、再起動すればまたゲートが出る＝
//   回避にはならない。逆に BackHandler で完全に握ると「戻るが効かない＝
//   フリーズした」と読まれるため、あえて何もしない。
// ============================================================================

// 保存に**失敗し続けた**人にだけ脱出口を出す閾値。
// 電波の良い通常のユーザーには最後まで見えないので、名前の回収率には影響しない。
// サーバー側の権限退行（profiles の列 GRANT 事故など）で保存が必ず失敗する状態に
// なったとき、アプリが起動不能になるのを防ぐ唯一のクライアント側フェイルセーフ。
const SKIP_AFTER_FAILURES = 2;

const MAX_NAME_LENGTH = 30;

export function NameSetupScreen({
  userId,
  onSaved,
  onSkip,
}: {
  userId: string;
  /** 保存に成功したときだけ呼ぶ。呼び出し側はここでキャッシュを書く。 */
  onSaved: () => void;
  /** 失敗して諦めたとき。★キャッシュを書かせない（次回起動でまた出す）。 */
  onSkip: () => void;
}) {
  // ★★ フックはすべてこのブロックに集約する。
  //    この下に early return を書いてもよいが、**early return より後ろに
  //    フックを足すのは禁止**（順序が壊れて 100% クラッシュする。mobile には
  //    eslint が無く tsc をすり抜けるため、レビューでしか防げない）。
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState(0);
  // ★AppState リスナーは絶対に足さない: Android に "inactive" は無く、共有シートや
  //   権限ダイアログのたびに background→active が飛ぶ。復帰で再判定すると
  //   **全画面ゲートがライブ配信画面に被さる**（このプロダクト最悪の事故）。

  const isPortrait = height >= width;

  const handleSubmit = useCallback(async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名前を入力してください");
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`${MAX_NAME_LENGTH}文字以内で入力してください`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const updated = await updateDisplayName(userId, trimmed);
      // ★成功したときだけ閉じる。updateDisplayName は throw せず失敗時 null を返すので、
      //   await しただけで閉じると「保存されていないのにゲートが消える」＝この機能が丸ごと無意味になる。
      if (updated) {
        onSaved();
        return;
      }
      setFailures((n) => n + 1);
      setError("保存に失敗しました。電波状況をご確認のうえ、再度お試しください。");
    } finally {
      // ★Web 版(name-setup-modal.tsx)は成功パスで setSaving(false) を呼んでいない。
      //   Web は再描画でモーダルごと消えるので露見しないが、そのまま写すと
      //   ここでは「保存中...」のまま永久ロックする。必ず finally に置く。
      setSaving(false);
    }
  }, [name, onSaved, saving, userId]);

  const handleLogout = useCallback(() => {
    Alert.alert(
      "別のアカウントでログインしますか？",
      "現在のアカウントからログアウトします。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "ログアウト",
          style: "destructive",
          onPress: () => {
            supabase.auth.signOut().catch(() => {});
          },
        },
      ],
    );
  }, []);

  return (
    <View
      style={[
        styles.root,
        {
          // ★SafeAreaView（react-native 版）は iOS 専用で Android では効かない。
          //   insets を自前で当てる。app.json の orientation は "default" ＝横持ちに
          //   回るので、上下だけでなく left/right も必ず空ける（ノッチ・ナビバー対策）。
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            // 横持ちだと縦中央寄せではシートがはみ出すので上寄せに切り替える。
            !isPortrait && styles.scrollContentLandscape,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.sheet}>
            {/* ★文言は Web（「ようこそ！」）と意図的に変えている。
                このゲートはリリース直後、**既存ユーザーのほぼ半数**に一斉に出る。
                1ヶ月配信してきた課金ユーザーに「ようこそ！」と表示すると
                「アカウントが初期化された」と誤読され、問い合わせを自分で作りにいく。
                新規・既存の両方で自然に読める中立文言にしてある。 */}
            <Text style={styles.title}>お名前を教えてください</Text>
            <Text style={styles.body}>
              チームメンバーや他のユーザーに表示される名前です。{"\n"}
              本名でなくてもかまいません。
            </Text>

            <Text style={styles.label}>表示名</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (error) setError("");
              }}
              placeholder="例: 田中太郎"
              placeholderTextColor="#666"
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              editable={!saving}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.primary, (saving || !name.trim()) && styles.disabled]}
              onPress={handleSubmit}
              disabled={saving || !name.trim()}
            >
              <Text style={styles.primaryText}>{saving ? "保存中..." : "はじめる"}</Text>
            </Pressable>

            <Text style={styles.hint}>名前はマイページからいつでも変更できます</Text>

            {failures >= SKIP_AFTER_FAILURES ? (
              <Pressable style={styles.ghost} onPress={onSkip} hitSlop={8}>
                <Text style={styles.ghostText}>あとで設定する</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.ghost} onPress={handleLogout} hitSlop={8}>
              <Text style={styles.ghostText}>別のアカウントでログイン</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 },
  scrollContentLandscape: { justifyContent: "flex-start", paddingTop: 12 },
  sheet: { backgroundColor: "#141414", borderRadius: 14, padding: 18 },
  title: { fontSize: 18, fontWeight: "800", color: "#fff", marginBottom: 8 },
  body: { fontSize: 14, color: "#bbb", lineHeight: 20, marginBottom: 16 },
  label: { fontSize: 12, color: "#888", marginBottom: 6 },
  input: {
    backgroundColor: "#0a0a0a",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#fff",
  },
  error: { fontSize: 12, color: "#ffb4b4", marginTop: 8 },
  primary: {
    backgroundColor: "#e63946",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 16,
  },
  primaryText: { fontSize: 15, fontWeight: "800", color: "#fff" },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 11, color: "#666", textAlign: "center", marginTop: 12 },
  ghost: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  ghostText: { fontSize: 12, color: "#888", textDecorationLine: "underline" },
});
