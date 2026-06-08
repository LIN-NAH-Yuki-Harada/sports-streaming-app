import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useTracks,
  isTrackReference,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { supabase } from "./lib/supabase";
import { LIVEKIT_URL, SITE_URL } from "./config";

// PoC: ログイン → 配信作成 → トークン取得 → カメラをネイティブ(ハードエンコーダ)で publish。
// 視聴は既存Web( https://live-spotch.com/watch/<code> )で確認。発熱(冷たさ)も実機で体感。

type Phase = "checking" | "login" | "ready" | "live";

const SHARE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateShareCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += SHARE_CHARS[Math.floor(Math.random() * SHARE_CHARS.length)];
  }
  return s;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setPhase(data.session ? "ready" : "login");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setPhase((prev) => (prev === "live" ? prev : session ? "ready" : "login"));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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

  const handleStart = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        setMessage("セッションがありません。再ログインしてください。");
        setBusy(false);
        return;
      }
      const code = generateShareCode();

      const { error: insErr } = await supabase.from("broadcasts").insert({
        broadcaster_id: session.user.id,
        share_code: code,
        sport: "サッカー",
        home_team: "テスト(アプリ)",
        away_team: "テスト(アプリ)",
        tournament: "アプリPoC",
        period: "前半",
        home_score: 0,
        away_score: 0,
        status: "live",
        scoreboard_burned_in: false,
      });
      if (insErr) {
        setMessage("配信作成エラー: " + insErr.message);
        setBusy(false);
        return;
      }

      const res = await fetch(SITE_URL + "/api/livekit/token", {
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
      });
      const json = await res.json();
      if (!res.ok || !json.token) {
        setMessage("トークン取得エラー: " + (json.error ?? res.status));
        setBusy(false);
        return;
      }

      await AudioSession.startAudioSession();
      setToken(json.token);
      setShareCode(code);
      setPhase("live");
    } catch (e) {
      setMessage("開始エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    await AudioSession.stopAudioSession().catch(() => {});
    if (shareCode) {
      await supabase
        .from("broadcasts")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("share_code", shareCode);
    }
    setToken(null);
    setShareCode(null);
    setPhase("ready");
  }, [shareCode]);

  if (phase === "checking") {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#e63946" />
      </SafeAreaView>
    );
  }

  if (phase === "live" && token) {
    return (
      <LiveKitRoom serverUrl={LIVEKIT_URL} token={token} connect={true} audio={true} video={true}>
        <LiveView shareCode={shareCode} onStop={handleStop} />
      </LiveKitRoom>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>LIVE SPOtCH 配信(PoC)</Text>

      {phase === "login" ? (
        <View style={styles.form}>
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
          <Pressable style={styles.button} onPress={handleLogin} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "..." : "ログイン"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.ready}>ログイン済み。配信を開始できます。</Text>
          <Pressable style={styles.button} onPress={handleStart} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "準備中..." : "配信開始"}</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.linkText}>ログアウト</Text>
          </Pressable>
        </View>
      )}

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </SafeAreaView>
  );
}

function LiveView({ shareCode, onStop }: { shareCode: string | null; onStop: () => void }) {
  const tracks = useTracks([Track.Source.Camera]);
  const cam = tracks.find((t) => isTrackReference(t) && t.participant.isLocal) ?? tracks[0];

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

      <SafeAreaView style={styles.overlay}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>● 配信中（焼き込みOFF）</Text>
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.bottom}>
        <Text style={styles.codeLabel}>視聴: live-spotch.com/watch/</Text>
        <Text style={styles.code}>{shareCode}</Text>
        <Pressable style={styles.stopButton} onPress={onStop}>
          <Text style={styles.buttonText}>配信を停止</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 28 },
  form: { gap: 10 },
  label: { color: "#bbb", fontSize: 13 },
  input: { backgroundColor: "#1a1a1a", color: "#fff", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#333" },
  ready: { color: "#ddd", fontSize: 15, textAlign: "center", marginBottom: 8 },
  button: { backgroundColor: "#e63946", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkButton: { padding: 10, alignItems: "center" },
  linkText: { color: "#888", fontSize: 13 },
  message: { color: "#ffb4b4", marginTop: 16, textAlign: "center" },
  liveRoot: { flex: 1, backgroundColor: "#000" },
  video: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  connecting: { color: "#fff", marginTop: 8 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, padding: 12 },
  badge: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: "#e63946", fontWeight: "700", fontSize: 12 },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: "rgba(0,0,0,0.55)" },
  codeLabel: { color: "#aaa", fontSize: 12, textAlign: "center" },
  code: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: 2, textAlign: "center", marginBottom: 10 },
  stopButton: { backgroundColor: "#444", borderRadius: 8, padding: 12, alignItems: "center" },
});
