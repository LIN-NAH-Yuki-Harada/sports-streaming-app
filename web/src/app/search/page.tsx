"use client";

import { useState } from "react";

const FILTERS = ["すべて", "ライブ", "アーカイブ"];
const SPORT_FILTERS = ["全種目", "サッカー", "野球", "バスケ", "バレー"];

const MATCHES = [
  { sport: "サッカー", home: "港FC", away: "青葉SC", score: "2 - 1", time: "後半 32:15", viewers: 24, tournament: "港区少年サッカー大会", live: true },
  { sport: "野球", home: "東中学校", away: "西中学校", score: "3 - 5", time: "6回裏", viewers: 18, tournament: "市中学校春季大会", live: true },
  { sport: "バスケ", home: "さくらミニバス", away: "若葉クラブ", score: "28 - 24", time: "3Q 4:30", viewers: 31, tournament: "県ミニバスケ交流戦", live: true },
  { sport: "バレー", home: "光丘中", away: "みどり中", score: "2 - 0", time: "終了", viewers: 89, tournament: "地区中学バレー選手権", live: false },
  { sport: "サッカー", home: "若松少年団", away: "城東キッカーズ", score: "1 - 1", time: "終了 (PK 3-2)", viewers: 214, tournament: "春季少年サッカー大会", live: false },
];

export default function SearchPage() {
  const [statusFilter, setStatusFilter] = useState("すべて");
  const [sportFilter, setSportFilter] = useState("全種目");
  const [query, setQuery] = useState("");

  const filtered = MATCHES.filter((m) => {
    if (statusFilter === "ライブ" && !m.live) return false;
    if (statusFilter === "アーカイブ" && m.live) return false;
    if (sportFilter !== "全種目" && m.sport !== sportFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        m.home.toLowerCase().includes(q) ||
        m.away.toLowerCase().includes(q) ||
        m.tournament.toLowerCase().includes(q) ||
        m.sport.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const liveMatches = filtered.filter((m) => m.live);
  const archiveMatches = filtered.filter((m) => !m.live);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      {/* 検索 */}
      <input
        type="text"
        placeholder="チーム名、種目、地域でさがす"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-[#111] border border-white/10 rounded-md px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
      />

      {/* フィルター */}
      <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1 rounded-md transition ${
              statusFilter === f
                ? "bg-white/10 text-white"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="w-px bg-white/10 mx-1" />
        {SPORT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setSportFilter(f)}
            className={`px-3 py-1 rounded-md transition ${
              sportFilter === f
                ? "bg-white/10 text-white"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* ライブ */}
      {(statusFilter === "すべて" || statusFilter === "ライブ") &&
        liveMatches.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e63946] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#e63946]" />
              </span>
              <h2 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
                Live
              </h2>
            </div>
            <div className="space-y-2">
              {liveMatches.map((m) => (
                <MatchRow key={m.home + m.away} match={m} />
              ))}
            </div>
          </div>
        )}

      {/* アーカイブ */}
      {(statusFilter === "すべて" || statusFilter === "アーカイブ") &&
        archiveMatches.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xs font-semibold tracking-wide text-gray-400 uppercase mb-4">
              アーカイブ
            </h2>
            <div className="space-y-2">
              {archiveMatches.map((m) => (
                <MatchRow key={m.home + m.away} match={m} />
              ))}
            </div>
          </div>
        )}

      {/* 結果なし */}
      {filtered.length === 0 && (
        <div className="mt-20 text-center">
          <p className="text-sm text-gray-500">該当する試合がありません</p>
          <p className="text-xs text-gray-700 mt-1">
            検索条件を変えてみてください
          </p>
        </div>
      )}

      <p className="mt-8 text-center text-[10px] text-gray-700">
        視聴するには配信者から共有コードを受け取ってください
      </p>
      <p className="mt-2 text-center text-[11px] text-gray-700 pb-16">
        デモデータを表示しています
      </p>
    </div>
  );
}

function MatchRow({
  match: m,
}: {
  match: (typeof MATCHES)[number];
}) {
  return (
    <div
      className="rounded-md bg-[#111] border border-white/5 px-4 py-3"
    >
      {/* スマホ: 縦積み / PC: 横並び */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-gray-600 shrink-0">{m.sport}</span>
          {m.live && (
            <span className="text-[9px] text-[#e63946] font-bold shrink-0">
              LIVE
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-600">{m.time}</span>
      </div>
      <div className="flex items-center justify-between mt-1 sm:mt-0">
        <span className="hidden sm:inline text-[10px] text-gray-600 w-12 shrink-0">
          {m.sport}
        </span>
        <span className="text-sm font-medium truncate flex-1">{m.home}</span>
        <span
          className={`text-base font-black tabular-nums tracking-wider mx-3 shrink-0 ${
            m.live ? "text-[#e63946]" : "text-white"
          }`}
        >
          {m.score}
        </span>
        <span className="text-sm font-medium truncate flex-1 text-right">
          {m.away}
        </span>
        <span className="hidden sm:inline text-[10px] text-gray-600 w-20 text-right shrink-0 ml-3">
          {m.time}
        </span>
        <span className="hidden sm:inline text-[10px] text-gray-700 w-8 text-right">
          {m.viewers}
        </span>
      </div>
      {/* スマホ: 大会名と視聴者数 */}
      <div className="flex items-center justify-between mt-1 sm:hidden">
        <span className="text-[10px] text-gray-700 truncate">
          {m.tournament}
        </span>
        <span className="text-[10px] text-gray-700 shrink-0">
          {m.viewers}人
        </span>
      </div>
    </div>
  );
}
