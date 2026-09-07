import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

// ライブ応援スタンプ（❤️/👍）— Web 版 web/src/components/live-reactions.tsx と
// 同一の Supabase Realtime broadcast 仕様（チャンネル reactions-${shareCode}・
// イベント "react"・payload { kind }）。DB 書き込みなしの ephemeral。
//
// 表示位置は「右端に沿って上昇」：中央のプレー映像にかからない配置
// （2026-07-11 バレー実戦FBで下中央→右端に統一。Web 版 PR#215 と同じ）。
//
// showButtons=true で送信ボタン（❤️/👍 右端縦積み）も表示する（視聴画面用）。
// false なら受信表示のみ（配信者画面用）。

type ReactionKind = "heart" | "clap";
const EMOJI: Record<ReactionKind, string> = { heart: "❤️", clap: "👍" };

// 連打対策: 送信は最短 120ms 間隔（Web と同値）。同時表示は最大 30 個。
const SEND_THROTTLE_MS = 120;
const MAX_ON_SCREEN = 30;

type FloatingReaction = {
  id: number;
  emoji: string;
  right: number; // 右端からの%（右端に沿わせる）
  drift: number; // 上昇しながらの横ドリフト(px)
  size: number;
  anim: Animated.Value;
};

export function LiveReactions({
  shareCode,
  showButtons = false,
  buttonsBottom = 96,
}: {
  shareCode: string;
  showButtons?: boolean;
  /** 送信ボタン縦積みの bottom(px)。右下の他ボタンと重ならない位置を親が指定する。 */
  buttonsBottom?: number;
}) {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const idRef = useRef(0);
  const lastSentRef = useRef(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const spawn = useCallback((kind: ReactionKind) => {
    const id = idRef.current++;
    const anim = new Animated.Value(0);
    const item: FloatingReaction = {
      id,
      emoji: EMOJI[kind],
      right: 4 + Math.random() * 10, // 右端 4〜14%（プレー映像にかからない）
      drift: Math.random() * 32 - 16, // -16〜16px
      size: 18 + Math.random() * 10, // 18〜28px（控えめサイズ）
      anim,
    };
    setItems((prev) => (prev.length >= MAX_ON_SCREEN ? prev.slice(1) : prev).concat(item));
    Animated.timing(anim, {
      toValue: 1,
      duration: 2400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    });
  }, []);

  // 受信購読（自分の送信は self:false で受信しない＝ローカル即時 spawn 済みのため）
  useEffect(() => {
    if (!shareCode) return;
    const channel = supabase.channel(`reactions-${shareCode}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "react" }, ({ payload }) => {
        const kind = (payload as { kind?: string })?.kind;
        if (kind === "heart" || kind === "clap") spawn(kind);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channel.unsubscribe().catch(() => {});
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [shareCode, spawn]);

  // 送信: ローカル即時表示 + 全視聴者/配信者へ broadcast（throttle）
  const send = useCallback(
    (kind: ReactionKind) => {
      spawn(kind);
      const now = Date.now();
      if (now - lastSentRef.current < SEND_THROTTLE_MS) return;
      lastSentRef.current = now;
      channelRef.current
        ?.send({ type: "broadcast", event: "react", payload: { kind } })
        .catch(() => {});
    },
    [spawn],
  );

  // 浮遊絵文字の湧き位置。ボタン表示時はボタン積み（36px×2+gap8≒80px）の
  // すぐ上から湧かせ、ボタンの裏から出てくる見え方を避ける。
  const emojiBottom = showButtons ? buttonsBottom + 88 : 150;

  return (
    <>
      {/* 浮かぶスタンプ層（タップ透過・操作を邪魔しない） */}
      <View style={styles.layer} pointerEvents="none">
        {items.map((it) => {
          const translateY = it.anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -220],
          });
          const translateX = it.anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, it.drift],
          });
          const opacity = it.anim.interpolate({
            inputRange: [0, 0.15, 0.8, 1],
            outputRange: [0, 1, 1, 0],
          });
          const scale = it.anim.interpolate({
            inputRange: [0, 0.15, 1],
            outputRange: [0.6, 1, 1],
          });
          return (
            <Animated.Text
              key={it.id}
              style={[
                styles.emoji,
                {
                  right: `${it.right}%`,
                  bottom: emojiBottom,
                  fontSize: it.size,
                  opacity,
                  transform: [{ translateY }, { translateX }, { scale }],
                },
              ]}
            >
              {it.emoji}
            </Animated.Text>
          );
        })}
      </View>

      {/* 送信ボタン（右端縦積み・視聴画面用） */}
      {showButtons ? (
        <View style={[styles.buttons, { bottom: buttonsBottom }]}>
          <Pressable
            onPress={() => send("heart")}
            accessibilityLabel="ハートで応援"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonEmoji}>❤️</Text>
          </Pressable>
          <Pressable
            onPress={() => send("clap")}
            accessibilityLabel="いいねで応援"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonEmoji}>👍</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  emoji: { position: "absolute" },
  buttons: {
    position: "absolute",
    right: 14,
    alignItems: "center",
    gap: 8,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: { transform: [{ scale: 0.9 }], backgroundColor: "rgba(0,0,0,0.75)" },
  buttonEmoji: { fontSize: 16 },
});
