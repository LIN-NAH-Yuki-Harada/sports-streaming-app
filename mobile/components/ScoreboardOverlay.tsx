import { useEffect, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WatchBroadcast } from "../lib/watch-data";

// 視聴画面のスコアボード・オーバーレイ（ネイティブ版）。
// Web 版 web/src/components/viewer-scoreboard-overlay.tsx の見た目を移植。
//
// ■ サイズ設計
// 文字サイズは「画面の短辺」基準でスケールする（横画面では短辺=高さ）。Web 版で 2026-06-15 に
// 直したのと同じ思想で、横画面でスコアが肥大化しないようにする（幅基準にしない）。子要素は
// すべてベース fs の比率で表現し、全体が比率を保って拡縮する。
//
// 左上=スコア（チーム/得点/ピリオド）/ その下=セットP・マッチP / さらに下=野球 B/S/O＋走者 /
// 左下=経過時間。右上の LIVE・視聴者数・試合名は WatchScreen 側で配置する（重なり回避）。
export function ScoreboardOverlay({ b }: { b: WatchBroadcast }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // 短辺 × 係数を 11〜15px に収める（Web の clamp(11px, 2.4vh, 15px) と同等の考え方）。
  const fs = Math.max(11, Math.min(15, Math.round(Math.min(width, height) * 0.034)));

  const elapsed = useElapsedSeconds(b.started_at, b.status === "live");
  const showSets = b.home_sets > 0 || b.away_sets > 0;
  const isBaseball = b.sport === "野球";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* 左上: スコアボード */}
      <View style={[styles.topLeft, { top: insets.top + 10, left: 12 }]}>
        <View style={styles.scoreRow}>
          <View style={styles.segTeam}>
            <Text style={[styles.team, { fontSize: fs }]} numberOfLines={1}>
              {b.home_team}
            </Text>
            {showSets ? (
              <Text style={[styles.sets, { fontSize: fs * 0.72 }]}>{b.home_sets}</Text>
            ) : null}
          </View>
          <View style={styles.segScore}>
            <Text style={[styles.score, { fontSize: fs }]}>{b.home_score}</Text>
            <Text style={[styles.dash, { fontSize: fs * 0.7 }]}>-</Text>
            <Text style={[styles.score, { fontSize: fs }]}>{b.away_score}</Text>
          </View>
          <View style={styles.segTeam}>
            {showSets ? (
              <Text style={[styles.sets, { fontSize: fs * 0.72 }]}>{b.away_sets}</Text>
            ) : null}
            <Text style={[styles.team, { fontSize: fs }]} numberOfLines={1}>
              {b.away_team}
            </Text>
          </View>
          <View style={styles.segPeriod}>
            <Text style={[styles.period, { fontSize: fs }]}>{b.period}</Text>
          </View>
        </View>

        {b.point_label ? (
          <View style={styles.pointWrap}>
            <View
              style={[
                styles.pointBadge,
                b.point_label === "マッチポイント" ? styles.pointMatch : styles.pointSet,
              ]}
            >
              <Text
                style={[
                  b.point_label === "マッチポイント"
                    ? styles.pointMatchText
                    : styles.pointSetText,
                  { fontSize: fs * 0.85 },
                ]}
              >
                {b.point_label}
              </Text>
            </View>
          </View>
        ) : null}

        {/* 野球: 甲子園TV中継風の B/S/O ＋ 走者ダイヤ */}
        {isBaseball ? (
          <View style={styles.bsoRow}>
            <CountDots label="B" count={b.balls ?? 0} total={3} color="#4ade80" fs={fs} />
            <CountDots label="S" count={b.strikes ?? 0} total={2} color="#facc15" fs={fs} />
            <CountDots label="O" count={b.outs ?? 0} total={2} color="#ef4444" fs={fs} />
            <RunnerDiamond runners={b.runners} fs={fs} />
          </View>
        ) : null}
      </View>

      {/* 左下: 配信経過時間 */}
      {elapsed !== null ? (
        <View style={[styles.bottomLeft, { bottom: insets.bottom + 10, left: 12 }]}>
          <Text style={[styles.elapsed, { fontSize: fs * 0.85 }]}>
            {formatElapsed(elapsed)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// 野球の B/S/O カウントを「ラベル＋点灯ドット」で表示（甲子園テロップ風）。
function CountDots({
  label,
  count,
  total,
  color,
  fs,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  fs: number;
}) {
  const dot = Math.round(fs * 0.55);
  return (
    <View style={styles.countGroup}>
      <Text style={[styles.countLabel, { fontSize: fs * 0.6 }]}>{label}</Text>
      <View style={styles.dotRow}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              marginLeft: i === 0 ? 0 : 3,
              backgroundColor: i < count ? color : "rgba(255,255,255,0.2)",
            }}
          />
        ))}
      </View>
    </View>
  );
}

// 走者ダイヤ（二塁=上 / 三塁=左 / 一塁=右）。塁上に走者がいれば点灯。
function RunnerDiamond({
  runners,
  fs,
}: {
  runners: WatchBroadcast["runners"];
  fs: number;
}) {
  const r = runners ?? {};
  const box = Math.round(fs * 1.5);
  const sq = Math.round(fs * 0.5);
  const sqStyle = (on?: boolean) => ({
    position: "absolute" as const,
    width: sq,
    height: sq,
    backgroundColor: on ? "#facc15" : "rgba(255,255,255,0.2)",
    transform: [{ rotate: "45deg" }],
  });
  return (
    <View style={{ width: box, height: box }}>
      <View style={[sqStyle(r.second), { top: Math.round(box * 0.05), left: Math.round(box * 0.32) }]} />
      <View style={[sqStyle(r.third), { top: Math.round(box * 0.36), left: 0 }]} />
      <View style={[sqStyle(r.first), { top: Math.round(box * 0.36), left: Math.round(box * 0.64) }]} />
    </View>
  );
}

// started_at からの経過秒数を 1 秒ごとに更新（live のときのみ進行）。Web 版と同じ実装。
function useElapsedSeconds(startedAt: string, live: boolean): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }
    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs)) {
      setElapsed(null);
      return;
    }
    const compute = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    compute();
    if (!live) return;
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [startedAt, live]);
  return elapsed;
}

function formatElapsed(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const styles = StyleSheet.create({
  topLeft: { position: "absolute", alignItems: "flex-start" },
  bottomLeft: { position: "absolute" },

  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 4,
    overflow: "hidden",
  },
  segTeam: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    gap: 5,
  },
  team: { color: "#fff", fontWeight: "700" },
  sets: { color: "#facc15", fontWeight: "700", fontVariant: ["tabular-nums"] },
  segScore: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#e63946",
    gap: 3,
  },
  score: { color: "#fff", fontWeight: "900", fontVariant: ["tabular-nums"] },
  dash: { color: "rgba(255,255,255,0.6)" },
  segPeriod: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  period: { color: "#fff", fontWeight: "500", fontVariant: ["tabular-nums"] },

  pointWrap: { marginTop: 5, flexDirection: "row" },
  pointBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  pointMatch: { backgroundColor: "#e63946" },
  pointSet: { backgroundColor: "#f4a300" },
  pointMatchText: { color: "#fff", fontWeight: "900" },
  pointSetText: { color: "#1a1a1a", fontWeight: "900" },

  bsoRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 10,
  },
  countGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  countLabel: { color: "#d1d5db", fontWeight: "700" },
  dotRow: { flexDirection: "row", alignItems: "center" },

  elapsed: {
    color: "#fff",
    fontWeight: "500",
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    fontVariant: ["tabular-nums"],
  },
});
