"use client";

import { useState, useEffect } from "react";

const LIVE_NOW = [
  { sport: "サッカー", home: "港FC", away: "青葉SC", area: "東京都港区", tournament: "港区少年サッカー大会" },
  { sport: "野球", home: "東中学校", away: "西中学校", area: "神奈川県横浜市", tournament: "市中学校春季大会" },
  { sport: "バスケ", home: "さくらミニバス", away: "若葉クラブ", area: "埼玉県さいたま市", tournament: "県ミニバスケ交流戦" },
];


export default function Home() {
  const [code, setCode] = useState("");
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // ホーム画面から起動した場合（PWAモード）を判定
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);
  }, []);

  return (
    <div>
      {/* ヘッダー */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
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

      {/* ホーム画面追加の誘導（PWAモードでは非表示） */}
      {!isStandalone && <section className="px-5 pt-8">
        <div className="rounded-xl bg-gradient-to-br from-[#e63946]/10 via-[#111] to-[#111] border border-[#e63946]/20 p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#e63946]/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-[#e63946] flex items-center justify-center shadow-lg shadow-[#e63946]/20">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold">もっと快適に配信・視聴</p>
                <p className="text-[10px] text-gray-500">ホーム画面に追加するだけ</p>
              </div>
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed mt-3">
              ホーム画面に追加すると、URLバーが消えて<strong className="text-gray-300">全画面で配信・視聴</strong>ができます。アプリのようにワンタップで起動。
            </p>

            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="rounded-lg bg-black/30 px-2 py-2 text-center">
                <svg className="w-4 h-4 text-[#e63946] mx-auto mb-1" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                <p className="text-[9px] text-gray-400">全画面配信</p>
              </div>
              <div className="rounded-lg bg-black/30 px-2 py-2 text-center">
                <svg className="w-4 h-4 text-[#e63946] mx-auto mb-1" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="text-[9px] text-gray-400">ワンタップ起動</p>
              </div>
              <div className="rounded-lg bg-black/30 px-2 py-2 text-center">
                <svg className="w-4 h-4 text-[#e63946] mx-auto mb-1" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p className="text-[9px] text-gray-400">アプリ感覚</p>
              </div>
            </div>

            <div className="flex gap-3 mt-4 pt-3 border-t border-white/5">
              <div className="flex-1 rounded-lg bg-black/40 px-3 py-2">
                <p className="text-[9px] text-[#e63946] font-bold mb-1">iPhone</p>
                <p className="text-[9px] text-gray-500">共有ボタン □↑ → ホーム画面に追加</p>
              </div>
              <div className="flex-1 rounded-lg bg-black/40 px-3 py-2">
                <p className="text-[9px] text-[#e63946] font-bold mb-1">Android</p>
                <p className="text-[9px] text-gray-500">メニュー ︙ → ホーム画面に追加</p>
              </div>
            </div>
          </div>
        </div>
      </section>}

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
