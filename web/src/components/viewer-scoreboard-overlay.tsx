"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Broadcast } from "@/lib/database";

/**
 * 視聴ページ用スコアボード・オーバーレイ（発熱対策 Phase 1-A）。
 *
 * 焼き込み OFF の配信（scoreboard_burned_in=false）では、配信スマホは生映像のみを
 * 送る（合成しない＝発熱しない）。代わりに視聴者の画面で、この CSS オーバーレイを
 * 映像の上に重ねてスコアを表示する。
 *
 * 全画面でも消えないよう、watch ページ側で iPhone はフェイク全画面（CSS）に
 * 切り替える（useStageFullscreen の allowVideoFallback=false）。本コンポーネントは
 * ステージ要素の子として描画されるため、フェイク全画面でも一緒に拡大表示される。
 *
 * 見た目は scoreboard-canvas.ts の焼き込み版に合わせる（左上=スコア / 右上=大会名 /
 * 左下=経過時間）。バレーのセット/マッチポイント表示は、配信者が選んだルール設定が
 * broadcast 行に保存されていないため本オーバーレイでは省略する（既知の軽微な差分）。
 */
export function ViewerScoreboardOverlay({ broadcast }: { broadcast: Broadcast }) {
  const elapsed = useElapsedSeconds(
    broadcast.started_at,
    broadcast.status === "live",
  );

  const showSets = broadcast.home_sets > 0 || broadcast.away_sets > 0;
  const tournamentLabel = broadcast.tournament || broadcast.sport;
  const isBaseball = broadcast.sport === "野球";

  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {/* 左上: スコアボード */}
      <div
        className="absolute left-3 sm:left-4"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center bg-black/80 backdrop-blur-sm rounded overflow-hidden text-xs sm:text-sm md:text-base shadow-lg">
          <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 flex items-center gap-1.5">
            <span className="font-bold">{broadcast.home_team}</span>
            {showSets && (
              <span className="text-[10px] sm:text-xs text-yellow-400 font-bold tabular-nums">
                {broadcast.home_sets}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-[#e63946]">
            <span className="font-black tabular-nums">{broadcast.home_score}</span>
            <span className="text-[10px] text-white/60">-</span>
            <span className="font-black tabular-nums">{broadcast.away_score}</span>
          </div>
          <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 flex items-center gap-1.5">
            {showSets && (
              <span className="text-[10px] sm:text-xs text-yellow-400 font-bold tabular-nums">
                {broadcast.away_sets}
              </span>
            )}
            <span className="font-bold">{broadcast.away_team}</span>
          </div>
          <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-black/60">
            <span className="tabular-nums font-medium">{broadcast.period}</span>
          </div>
        </div>
        {broadcast.point_label && (
          <div className="mt-1.5">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs sm:text-sm font-black shadow-lg ${
                broadcast.point_label === "マッチポイント"
                  ? "bg-[#e63946] text-white"
                  : "bg-[#f4a300] text-black"
              }`}
            >
              {broadcast.point_label}
            </span>
          </div>
        )}

        {/* 野球: 甲子園TV中継風の B/S/O ＋ 走者ダイヤ */}
        {isBaseball && (
          <div className="mt-1.5 inline-flex items-center gap-2.5 bg-black/80 backdrop-blur-sm rounded px-2.5 py-1 shadow-lg">
            <CountDots label="B" count={broadcast.balls ?? 0} total={3} color="bg-green-400" />
            <CountDots label="S" count={broadcast.strikes ?? 0} total={2} color="bg-yellow-400" />
            <CountDots label="O" count={broadcast.outs ?? 0} total={2} color="bg-red-500" />
            <RunnerDiamond runners={broadcast.runners} />
          </div>
        )}
      </div>

      {/* 右上: 大会名 / 競技 */}
      {tournamentLabel && (
        <div
          className="absolute right-3 sm:right-4"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <div className="bg-black/80 backdrop-blur-sm rounded px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm text-gray-200 font-medium shadow-lg max-w-[40vw] truncate">
            {tournamentLabel}
          </div>
        </div>
      )}

      {/* 左下: 配信経過時間 */}
      {elapsed !== null && (
        <div
          className="absolute left-3 sm:left-4"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="bg-black/80 backdrop-blur-sm rounded px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium tabular-nums shadow-lg">
            {formatElapsed(elapsed)}
          </div>
        </div>
      )}
    </div>
  );
}

/** 野球の B/S/O カウントを「ラベル＋点灯ドット」で表示（甲子園テロップ風）。 */
function CountDots({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[9px] sm:text-[10px] font-bold text-gray-300">{label}</span>
      <span className="inline-flex gap-0.5">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`inline-block w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${
              i < count ? color : "bg-white/20"
            }`}
          />
        ))}
      </span>
    </span>
  );
}

/** 走者ダイヤ（二塁=上 / 三塁=左 / 一塁=右）。塁上に走者がいれば点灯。 */
function RunnerDiamond({
  runners,
}: {
  runners?: { first?: boolean; second?: boolean; third?: boolean } | null;
}) {
  const r = runners ?? {};
  const base = (on: boolean | undefined, style: CSSProperties) => (
    <span
      className={`absolute ${on ? "bg-yellow-400" : "bg-white/20"}`}
      style={{ width: 8, height: 8, transform: "rotate(45deg)", ...style }}
    />
  );
  return (
    <span className="relative inline-block" style={{ width: 22, height: 22 }}>
      {base(r.second, { top: 1, left: 7 })}
      {base(r.third, { top: 8, left: 0 })}
      {base(r.first, { top: 8, left: 14 })}
    </span>
  );
}

/**
 * started_at からの経過秒数を 1 秒ごとに更新して返す（live のときのみ進行）。
 * 実装は配信者側の経過時間タイマー（broadcast/page.tsx）と同じパターンに揃える。
 */
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
    function compute() {
      setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }
    compute();
    if (!live) return;
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [startedAt, live]);

  return elapsed;
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
