import * as React from "react";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { RtmpPublisherView, type RtmpStatus } from "./index";

/**
 * ネイティブ RTMP モジュールの単体検証画面（スパイク S0：端末側スコア焼き込み）。
 *
 * 使い方（EAS dev client ビルド後）:
 *   App.tsx の最初で `return <RtmpTestScreen />;` を一時的に返すように差し替えて起動。
 *   1. RTMP URL に「Larix で使った YouTube の URL（rtmp://a.rtmp.youtube.com/live2/＜キー＞）」を貼る
 *   2. 「配信開始」→ YouTube Studio のプレビューで映像と接続品質を確認（4G で見比べ）
 *
 * ★スパイクの確認ポイント:
 *   - 画面上部に焼き込まれたスコアボード（クロックが毎秒進む）が YouTube 側でも見えるか
 *   - 「+1」ボタンの得点更新が映像に反映されるか
 *   - 20〜30分連続で端末が異常発熱しないか（offscreen GPU 合成の負荷確認）
 *   - 焼き込み文字が鮮明か（720p）
 *   OK なら Path B 確定（端末焼き込み）。本番では URL を LiveKit Ingress でなく
 *   Cloudflare Stream の Live Input に向け、scoreboardText を実スコアボード整形に置換する。
 */
export default function RtmpTestScreen() {
  const [url, setUrl] = useState("");
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<RtmpStatus | "idle">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [camera, setCamera] = useState<"back" | "front">("back");
  const [fps60, setFps60] = useState(true); // 標準720p60fps・発熱比較用に30fps切替
  const width = 1280;
  const height = 720;
  const fps = fps60 ? 60 : 30;
  const bitrate = fps60 ? 6_000_000 : 4_000_000;

  // --- スコアボード（モック）---
  const [scoreVisible, setScoreVisible] = useState(true);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [elapsed, setElapsed] = useState(0); // 秒。配信中だけ進む

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;
  // 焼き込む1行（本番は実スコアボード整形に差し替え）
  const scoreboardText = `🔴 ホーム ${home} - ${away} アウェイ   ${mmss}`;

  return (
    <SafeAreaView style={styles.root}>
      <RtmpPublisherView
        key={fps60 ? "60" : "30"}
        style={styles.preview}
        streamUrl={url}
        active={active}
        videoWidth={width}
        videoHeight={height}
        videoBitrate={bitrate}
        fps={fps}
        cameraPosition={camera}
        scoreboardText={scoreboardText}
        scoreboardVisible={scoreVisible}
        onStatus={(e) => {
          setStatus(e.nativeEvent.state);
          setMessage(e.nativeEvent.message ?? null);
        }}
      />
      <View style={styles.controls}>
        <Text style={styles.status}>
          状態: {status}
          {message ? `（${message}）` : ""}
        </Text>
        <TextInput
          style={styles.input}
          placeholder="rtmp://a.rtmp.youtube.com/live2/＜ストリームキー＞"
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
        />
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, active ? styles.btnStop : styles.btnStart]}
            onPress={() => setActive((v) => !v)}
          >
            <Text style={styles.btnText}>{active ? "停止" : "配信開始"}</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnSub]}
            onPress={() => setCamera((c) => (c === "back" ? "front" : "back"))}
          >
            <Text style={styles.btnText}>カメラ: {camera}</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnSub]}
            onPress={() => {
              setActive(false); // fps変更は配信停止→再開で適用
              setFps60((v) => !v);
            }}
          >
            <Text style={styles.btnText}>720p {fps}fps</Text>
          </Pressable>
        </View>
        {/* スコアボード焼き込みの検証コントロール */}
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.btnScore]}
            onPress={() => setHome((v) => v + 1)}
          >
            <Text style={styles.btnText}>ホーム +1</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnScore]}
            onPress={() => setAway((v) => v + 1)}
          >
            <Text style={styles.btnText}>アウェイ +1</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnSub]}
            onPress={() => setScoreVisible((v) => !v)}
          >
            <Text style={styles.btnText}>
              スコア: {scoreVisible ? "表示" : "非表示"}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>焼き込み中: {scoreboardText}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  preview: { flex: 1 },
  controls: { padding: 16, gap: 12, backgroundColor: "#111" },
  status: { color: "#fff", fontSize: 14 },
  input: {
    backgroundColor: "#222",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  row: { flexDirection: "row", gap: 12 },
  btn: { flex: 1, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  btnStart: { backgroundColor: "#e63946" },
  btnStop: { backgroundColor: "#555" },
  btnSub: { backgroundColor: "#333" },
  btnScore: { backgroundColor: "#1d3557" },
  btnText: { color: "#fff", fontWeight: "600" },
  hint: { color: "#888", fontSize: 12 },
});
