"use client";

import { useState } from "react";

const LIVE_NOW = [
  { sport: "サッカー", home: "港FC", away: "青葉SC", area: "東京都港区", tournament: "港区少年サッカー大会" },
  { sport: "野球", home: "東中学校", away: "西中学校", area: "神奈川県横浜市", tournament: "市中学校春季大会" },
  { sport: "バスケ", home: "さくらミニバス", away: "若葉クラブ", area: "埼玉県さいたま市", tournament: "県ミニバスケ交流戦" },
];


export default function Home() {
  const [code, setCode] = useState("");

  return (
    <div>
      {/* ヘッダー */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-[#e63946] text-white text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider">
              LIVE
            </span>
            <span className="text-sm font-bold tracking-tight">LIVE SPOtCH</span>
          </div>
          <span className="text-[10px] text-gray-600">全国128チーム利用中</span>
        </div>
      </div>

      {/* 共有コードで視聴 */}
      <section className="px-5 pt-6">
        <h2 className="text-xs font-semibold text-gray-300 mb-3">
          共有コードで試合を見る
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="共有コードを入力（例: ABC123）"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="flex-1 bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition tracking-widest"
            maxLength={8}
          />
          <a
            href={code.trim() ? `/watch/${code.trim()}` : "#"}
            className={`shrink-0 px-5 py-2.5 rounded-md text-sm font-semibold transition ${
              code.trim()
                ? "bg-[#e63946] text-white hover:bg-[#d62836]"
                : "bg-white/5 text-gray-600 cursor-not-allowed"
            }`}
          >
            視聴
          </a>
        </div>
        <p className="mt-2 text-[10px] text-gray-700">
          配信者から共有されたコードまたはURLで視聴できます（アプリ登録が必要です）
        </p>
      </section>

      {/* 現在配信中（チーム名のみ公開、映像は非公開） */}
      <section className="px-5 pt-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e63946] opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#e63946]" />
          </span>
          <h2 className="text-xs font-semibold text-gray-300">いま配信中</h2>
          <span className="text-[10px] text-gray-600">{LIVE_NOW.length}件</span>
        </div>

        <div className="space-y-1.5">
          {LIVE_NOW.map((m) => (
            <div
              key={m.home + m.away}
              className="rounded-md bg-[#111] border border-white/5 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">
                    {m.home} vs {m.away}
                  </p>
                  <p className="text-[9px] text-gray-600 truncate mt-0.5">
                    {m.sport} / {m.tournament}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-[9px] text-gray-700">{m.area}</span>
                  <span className="text-[9px] text-[#e63946] font-semibold">LIVE</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-gray-700">
          視聴するには配信者から共有コードを受け取ってください
        </p>
      </section>

      {/* 導入チーム */}
      <section className="px-5 pt-8 pb-20">
        <h2 className="text-xs font-semibold text-gray-300 mb-3">
          利用中のチーム・団体
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            "港FC", "青葉SC", "東中学校", "さくらミニバス", "若葉クラブ",
            "光が丘FC", "明星SC", "大泉ジュニア", "桜台ミニバス", "石神井ファイターズ",
            "城東キッカーズ", "若松少年団",
          ].map((team) => (
            <span
              key={team}
              className="text-[10px] text-gray-500 bg-white/5 px-2.5 py-1 rounded-md"
            >
              {team}
            </span>
          ))}
          <span className="text-[10px] text-gray-600 px-2.5 py-1">
            ...ほか116チーム（全国128チーム）
          </span>
        </div>
      </section>
    </div>
  );
}
