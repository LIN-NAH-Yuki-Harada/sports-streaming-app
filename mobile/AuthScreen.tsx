import { useCallback, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  GoogleSignin,
  statusCodes,
  isSuccessResponse,
  isErrorWithCode,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "./lib/supabase";
import { SITE_URL, GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from "./config";

// Google などの第三者ログインを提供する iOS アプリは、App Store Guideline 4.8 により
// Sign in with Apple の併設が必須。iOS でのみ Apple ボタンを表示する。
const IS_IOS = Platform.OS === "ios";

// Google ネイティブログインの初期化（モジュール読み込み時に一度だけ）。
// webClientId は idToken 取得に必須、iosClientId は iOS のアカウントシート表示に必須。
GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
});

// ログイン / 新規登録 / パスワードリセット。認証されると App 側のセッション監視が
// 検知して自動的にタブ画面へ切り替わる（このコンポーネントはアンマウントされる）。
export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) setMessage("ログイン失敗: " + error.message);
  }, [email, password]);

  const handleSignup = useCallback(async () => {
    if (!email.trim() || password.length < 6) {
      setMessage("メールアドレスと6文字以上のパスワードを入力してください。");
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setMessage("登録に失敗しました: " + error.message);
    } else if (!data.session) {
      setMessage(
        "確認メールを送信しました。メール内のリンクで認証してから、ログインしてください。",
      );
      setAuthMode("login");
    }
  }, [email, password]);

  const handleResetPassword = useCallback(async () => {
    if (!email.trim()) {
      setMessage("メールアドレスを入力してから押してください。");
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${SITE_URL}/reset-password`,
    });
    setBusy(false);
    setMessage(
      error
        ? "送信に失敗しました: " + error.message
        : "パスワード再設定のメールを送信しました。",
    );
  }, [email]);

  // Sign in with Apple（iOS のみ・Guideline 4.8）。identityToken → Supabase セッション。
  const handleApple = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "apple",
          token: credential.identityToken,
        });
        if (error) setMessage("Appleログイン失敗: " + error.message);
      } else {
        setMessage("Appleログインに失敗しました（トークンなし）。");
      }
    } catch (e) {
      // ユーザーがキャンセルした場合は無言で戻す
      if ((e as { code?: string })?.code === "ERR_REQUEST_CANCELED") {
        // no-op
      } else {
        setMessage("Appleログインでエラーが発生しました。");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Google ネイティブログイン。アカウント選択シート → idToken → Supabase セッション。
  const handleGoogle = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (isSuccessResponse(response) && response.data.idToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: response.data.idToken,
        });
        if (error) setMessage("Googleログイン失敗: " + error.message);
      } else {
        setMessage("Googleログインがキャンセルされました。");
      }
    } catch (e) {
      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
        // ユーザーがキャンセル。無言で戻す。
      } else {
        setMessage("Googleログインでエラーが発生しました。");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>LIVE SPOtCH</Text>
        <Text style={styles.sub}>{authMode === "login" ? "ログイン" : "新規登録"}</Text>

        <View style={styles.form}>
          {/* Sign in with Apple（iOS のみ・Guideline 4.8 で Google と同等の視認性で併設） */}
          {IS_IOS ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
              }
              buttonStyle={
                AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              }
              cornerRadius={8}
              style={styles.appleButton}
              onPress={handleApple}
            />
          ) : null}
          <Pressable
            style={styles.googleButton}
            onPress={handleGoogle}
            disabled={busy}
          >
            <Text style={styles.googleButtonText}>Googleでログイン</Text>
          </Pressable>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>または メールで</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.label}>メールアドレス</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#666"
          />
          <Text style={styles.label}>パスワード</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="パスワード"
            placeholderTextColor="#666"
          />

          {authMode === "login" ? (
            <>
              <Pressable style={styles.button} onPress={handleLogin} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? "..." : "ログイン"}</Text>
              </Pressable>
              <Pressable
                style={styles.linkButton}
                onPress={() => {
                  setAuthMode("signup");
                  setMessage(null);
                }}
              >
                <Text style={styles.linkText}>はじめての方は「新規登録」</Text>
              </Pressable>
              <Pressable style={styles.linkButton} onPress={handleResetPassword}>
                <Text style={styles.linkText}>パスワードを忘れた方</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.button} onPress={handleSignup} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? "..." : "新規登録する"}</Text>
              </Pressable>
              <Pressable
                style={styles.linkButton}
                onPress={() => {
                  setAuthMode("login");
                  setMessage(null);
                }}
              >
                <Text style={styles.linkText}>すでにアカウントをお持ちの方（ログイン）</Text>
              </Pressable>
            </>
          )}
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { padding: 24, flexGrow: 1, justifyContent: "center" },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", textAlign: "center" },
  sub: { color: "#bbb", fontSize: 14, textAlign: "center", marginTop: 4, marginBottom: 20 },
  form: { gap: 8 },
  label: { color: "#bbb", fontSize: 13, marginTop: 4 },
  input: { backgroundColor: "#1a1a1a", color: "#fff", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#333" },
  button: { backgroundColor: "#e63946", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkButton: { padding: 10, alignItems: "center" },
  linkText: { color: "#888", fontSize: 13 },
  message: { color: "#ffb4b4", marginTop: 16, textAlign: "center" },
  appleButton: { height: 48, marginBottom: 8 },
  googleButton: { backgroundColor: "#fff", borderRadius: 8, padding: 14, alignItems: "center" },
  googleButtonText: { color: "#1a1a1a", fontSize: 16, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 10, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#333" },
  dividerText: { color: "#666", fontSize: 12 },
});
