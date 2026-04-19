"use client";

import { useState, useEffect } from "react";
import { getBroadcastHistory, type Broadcast } from "@/lib/database";

const SPORT_EMOJI: Record<string, string> = {
  サッカー: "⚽",
  野球: "⚾",
  バスケ: "🏀",
  バレー: "🏐",
  陸上: "🏃",
  その他: "🏆",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdays[d.getDay()];
  return `${month}/${day}（${weekday}）`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export default function HistoryPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBroadcastHistory().then((data) => {
      setBroadcasts(data);
      setLoading(false);
    });
  }, []);

  // 日付ごとにグループ化
  const grouped: { date: string; items: Broadcast[] }[] = [];
  for (const bc of broadcasts) {
    const date = formatDate(bc.started_at);
    const last = grouped[grouped.length - 1];
    if (last && last.date === date) {
      last.items.push(bc);
    } else {
      grouped.push({ date, items: [bc] });
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <h1 className="text-sm font-bold">配信履歴</h1>
      </div>

      <div className="px-5 md:px-8 lg:px-10 pb-20">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && broadcasts.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-gray-500">まだ配信履歴がありません</p>
            <p className="text-xs text-gray-600 mt-1">配信を行うとここに履歴が表示されます</p>
            <a href="/broadcast" className="inline-block mt-4 text-xs text-[#e63946] hover:underline">
              配信をはじめる
            </a>
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.date} className="mt-6 first:mt-2">
            <h2 className="text-xs text-gray-500 font-medium mb-2">
              {group.date}
            </h2>
            <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-3 lg:grid-cols-3">
              {group.items.map((bc) => (
                <div
                  key={bc.id}
                  className="rounded-lg bg-[#111] border border-white/5 px-4 py-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{SPORT_EMOJI[bc.sport] || "🏆"}</span>
                        <p className="text-sm font-medium truncate">
                          {bc.home_team} vs {bc.away_team}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {bc.tournament && (
                          <span className="text-xs text-gray-500">{bc.tournament}</span>
                        )}
                        <span className="text-xs text-gray-600">{formatTime(bc.started_at)}</span>
                      </div>
                    </div>
                    {/* スコア */}
                    <div className="shrink-0 ml-3 text-right">
                      {(bc.home_sets > 0 || bc.away_sets > 0) ? (
                        <>
                          <div className="flex items-center gap-1.5 bg-black/30 rounded px-2.5 py-1.5">
                            <span className="text-base font-black tabular-nums text-yellow-400">{bc.home_sets}</span>
                            <span className="text-xs text-gray-600">-</span>
                            <span className="text-base font-black tabular-nums text-yellow-400">{bc.away_sets}</span>
                          </div>
                          {bc.set_results && bc.set_results.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {bc.set_results.map((set: { home: number; away: number }, i: number) => (
                                <p key={i} className="text-[10px] text-gray-500 tabular-nums">
                                  S{i + 1}: {set.home}-{set.away}
                                </p>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5 bg-black/30 rounded px-2.5 py-1.5">
                          <span className="text-base font-black tabular-nums">{bc.home_score}</span>
                          <span className="text-xs text-gray-600">-</span>
                          <span className="text-base font-black tabular-nums">{bc.away_score}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
