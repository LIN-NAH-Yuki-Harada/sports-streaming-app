import * as React from "react";
import { useState } from "react";
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
 * ネイティブ RTMP モジュールの単体検証画面。
 *
 * 使い方（EAS dev client ビルド後）:
 *   App.tsx の最初で `return <RtmpTestScreen />;` を一時的に返すように差し替えて起動。
 *   1. RTMP URL に「Larix で使った YouTube の URL（rtmp://a.rtmp.youtube.com/live2/＜キー＞）」を貼る
 *   2. 「配信開始」→ YouTube Studio のプレビューで映像と接続品質を確認（4G で見比べ）
 *   ※ これが映れば「ネイティブモジュールが RTMP を正しく送れる」ことの実証になる。
 *      本番では URL を LiveKit Ingress（/api/livekit/ingress/start の rtmpUrl + "/" + streamKey）に差し替える。
 */
export default function RtmpTestScreen() {
  const [url, setUrl] = useState("");
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<RtmpStatus | "idle">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [camera, setCamera] = useState<"back" | "front">("back");

  return (
    <SafeAreaView style={styles.root}>
      <RtmpPublisherView
        style={styles.preview}
        streamUrl={url}
        active={active}
        videoWidth={1280}
        videoHeight={720}
        videoBitrate={4_000_000}
        fps={30}
        cameraPosition={camera}
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
        </View>
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
  btnText: { color: "#fff", fontWeight: "600" },
});
