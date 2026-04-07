"use client";

import { useState } from "react";

// サンプルデータ（Supabase接続後に動的取得）
const MY_TEAM = {
  name: "港FC",
  sport: "サッカー",
  members: 18,
  plan: "配信者プラン" as const,
};

const ARCHIVES = [
  { id: "1", date: "4/8", home: "港FC", away: "青葉SC", score: "2 - 1", tournament: "港区少年サッカー大会", duration: "1:23:45", daysAgo: 0 },
  { id: "2", date: "4/1", home: "港FC", away: "光が丘FC", score: "0 - 0", tournament: "練習試合", duration: "1:05:20", daysAgo: 7 },
  { id: "3", date: "3/25", home: "港FC", away: "明星SC", score: "3 - 2", tournament: "春季大会 準決勝", duration: "1:32:10", daysAgo: 14 },
  { id: "4", date: "3/10", home: "港FC", away: "城東キッカーズ", score: "1 - 1 (PK 3-2)", tournament: "春季大会 1回戦", duration: "1:45:30", daysAgo: 29 },
  { id: "5", date: "2/15", home: "港FC", away: "若松少年団", score: "4 - 0", tournament: "練馬区冬季大会", duration: "1:18:00", daysAgo: 52 },
  { id: "6", date: "1/20", home: "港FC", away: "石神井ファイターズ", score: "2 - 3", tournament: "新春カップ", duration: "1:28:15", daysAgo: 78 },
];

function isExpired(daysAgo: number) {
  return daysAgo > 30;
}

export default function TeamPage() {
  const [loggedIn] = useState(false);
  const [tab, setTab] = useState<"archive" | "schedule" | "members">("archive");

  // 未ログイン
  if (!loggedIn) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pt-4 pb-3">
          <h1 className="text-sm font-bold">チーム</h1>
        </div>

        <div className="px-5 pt-8 pb-20 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h2 className="text-base font-bold">チームチャンネル</h2>
          <p className="mt-2 text-xs text-gray-500 leading-relaxed">
            ログインすると、あなたのチームの
            <br />
            アーカイブやスケジュールを確認できます。
          </p>

          <div className="mt-8 rounded-lg bg-[#111] border border-white/5 p-5 text-left">
            <p className="text-xs font-semibold text-gray-300 mb-3">チームチャンネルでできること</p>
            <ul className="space-y-2.5 text-xs text-gray-500">
              <li className="flex items-start gap-2">
                <span className="text-[#e63946] mt-0.5">▶</span>
                <span>チームの試合アーカイブを一覧で視聴</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#e63946] mt-0.5">▶</span>
                <span>1ヶ月以内のアーカイブは無料で視聴可能</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-600 mt-0.5">▶</span>
                <span className="text-gray-600">チームスケジュール管理（チームプラン）</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-600 mt-0.5">▶</span>
                <span className="text-gray-600">メンバー管理・自動共有（チームプラン）</span>
              </li>
            </ul>
          </div>

          <p className="mt-6 text-[10px] text-gray-700">
            ログインするとチームに参加できます
          </p>
        </div>
      </div>
    );
  }

  // ログイン済み
  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-bold">チーム</h1>
          <span className="text-[10px] text-gray-600">{MY_TEAM.plan}</span>
        </div>
      </div>

      <div className="px-5 pb-20">
        {/* チーム情報 */}
        <div className="flex items-center gap-3 mt-4 mb-6">
          <div className="w-11 h-11 rounded-full bg-[#e63946]/10 flex items-center justify-center">
            <span className="text-sm font-bold text-[#e63946]">港</span>
          </div>
          <div>
            <p className="text-sm font-bold">{MY_TEAM.name}</p>
            <p className="text-[10px] text-gray-500">
              {MY_TEAM.sport} / メンバー {MY_TEAM.members}人
            </p>
          </div>
        </div>

        {/* タブ */}
        <div className="flex gap-1 mb-6">
          {([
            { key: "archive" as const, label: "アーカイブ" },
            { key: "schedule" as const, label: "スケジュール" },
            { key: "members" as const, label: "メンバー" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-md transition ${
                tab === t.key
                  ? "bg-white/10 text-white"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* アーカイブタブ */}
        {tab === "archive" && (
          <div className="space-y-2">
            {ARCHIVES.map((a) => {
              const expired = isExpired(a.daysAgo);
              return (
                <div
                  key={a.id}
                  className={`rounded-md bg-[#111] border px-4 py-3 ${
                    expired ? "border-white/5 opacity-60" : "border-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500">{a.date}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-600">{a.duration}</span>
                      {expired && (
                        <span className="text-[9px] text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                          ¥100
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs font-medium">
                    {a.home} vs {a.away}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-gray-600">{a.tournament}</p>
                    <span className="text-xs font-bold tabular-nums">{a.score}</span>
                  </div>
                  {expired && (
                    <button className="mt-2 w-full text-[10px] text-yellow-500 border border-yellow-500/20 rounded py-1.5 hover:bg-yellow-500/5 transition">
                      ¥100で視聴する（1ヶ月経過）
                    </button>
                  )}
                </div>
              );
            })}
            <p className="text-center text-[10px] text-gray-700 mt-4">
              1ヶ月以内のアーカイブは無料で視聴できます
            </p>
          </div>
        )}

        {/* スケジュールタブ */}
        {tab === "schedule" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-400">チームスケジュール</p>
            <p className="mt-1 text-[10px] text-gray-600">
              チームプラン（¥500/月）で利用できます
            </p>
            <button className="mt-4 text-xs text-[#e63946] border border-[#e63946]/30 px-4 py-2 rounded-md hover:bg-[#e63946]/5 transition">
              チームプランにアップグレード
            </button>
          </div>
        )}

        {/* メンバータブ */}
        {tab === "members" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-400">メンバー管理</p>
            <p className="mt-1 text-[10px] text-gray-600">
              チームプラン（¥500/月）で利用できます
            </p>
            <button className="mt-4 text-xs text-[#e63946] border border-[#e63946]/30 px-4 py-2 rounded-md hover:bg-[#e63946]/5 transition">
              チームプランにアップグレード
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
