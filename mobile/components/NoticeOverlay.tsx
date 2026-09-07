import { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

// 配信者からのお知らせテロップ（ネイティブ版）。
// Web 版 web/src/app/watch/[code]/page.tsx の「上部中央のテロップ」を移植し、
// さらに 2026-08-02 オーナー決定の「画面内ポップアップ」を足したもの。
//
// ■ 2つの状態を1つの要素で表現する
//   強調（数秒）: お知らせが変わった瞬間だけ大きく・赤背景で出す（見逃し防止）
//   通常（常設）: Web と同じ細い黒帯。配信者が消すまで出続ける
//
// 位置を上部中央に固定するのは意図的。スコアボードは左上、LIVE バッジは右上に
// あるため中央は空いており、かつ映像の中央（プレーが起きる場所）を塞がない。
// 全画面センターに出すと 4 秒間ゴールが見えなくなる事故が起きうる。
//
// 表示値は遅延させない（HLS 経路のスコアは OVERLAY_DELAY_MS 遅らせるが、お知らせは
// Web 版が非遅延の broadcast.notice を使っているため挙動を合わせる）。

// 強調表示を続ける時間。
const EMPHASIS_MS = 4000;

export function NoticeOverlay({
  notice,
  topInset,
}: {
  notice: string | null;
  topInset: number;
}) {
  const { width, height } = useWindowDimensions();
  // スコアボードと同じ「短辺基準」でスケールする（横画面で肥大化させない）。
  const fs = Math.max(11, Math.min(15, Math.round(Math.min(width, height) * 0.034)));

  const [emphasized, setEmphasized] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  // 直前のお知らせ。マウント時の初期値で埋めておき、画面を開いた瞬間に
  // 既存のお知らせでポップアップが出ないようにする（変化した時だけ出す）。
  const prevNotice = useRef<string | null>(notice);

  useEffect(() => {
    const text = notice?.trim() || null;
    if (text === prevNotice.current) return;
    prevNotice.current = text;
    // 消したとき（null 化）はポップアップ不要。
    if (!text) return;

    setEmphasized(true);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setEmphasized(false);
      });
    }, EMPHASIS_MS);

    return () => clearTimeout(timer);
  }, [notice, anim]);

  const text = notice?.trim() || null;
  if (!text) return null;

  return (
    <View
      style={[styles.wrap, { top: topInset + 10 }]}
      pointerEvents="none"
    >
      {/* 通常の細い帯（常設）。強調中はこの上にポップアップが重なる。 */}
      <View style={styles.band}>
        <Text style={[styles.bandText, { fontSize: fs }]} numberOfLines={2}>
          📢 {text}
        </Text>
      </View>

      {/* 強調ポップアップ（お知らせが変わった瞬間だけ・数秒で消える） */}
      {emphasized ? (
        <Animated.View
          style={[
            styles.popup,
            {
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text
            style={[styles.popupText, { fontSize: fs + 3 }]}
            numberOfLines={3}
          >
            📢 {text}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 上部中央。左右のスコアボード / LIVE バッジと重ならないよう幅を絞る。
  wrap: {
    position: "absolute",
    left: "20%",
    right: "20%",
    alignItems: "center",
  },
  band: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderWidth: 1,
    borderColor: "rgba(230,57,70,0.6)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bandText: {
    color: "#fff",
    textAlign: "center",
    lineHeight: 18,
  },
  // 帯と同じ位置に重ねる。帯より一回り大きく、赤地で必ず目に入るようにする。
  popup: {
    position: "absolute",
    top: 0,
    left: -20,
    right: -20,
    backgroundColor: "rgba(230,57,70,0.95)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  popupText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
  },
});
