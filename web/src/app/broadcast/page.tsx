"use client";

import { useState } from "react";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];

// スポーツ別ピリオド定義
const PERIODS: Record<string, string[]> = {
  "サッカー": ["前半", "後半", "延長"],
  "野球": ["1回表", "1回裏", "2回表", "2回裏", "3回表", "3回裏", "4回表", "4回裏", "5回表", "5回裏", "6回表", "6回裏", "7回表", "7回裏", "8回表", "8回裏", "9回表", "9回裏", "延長"],
  "バスケ": ["1Q", "2Q", "3Q", "4Q", "OT"],
  "バレー": ["1SET", "2SET", "3SET", "4SET", "5SET"],
  "陸上": ["競技中"],
  "その他": ["前半", "後半", "延長"],
};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

type Screen = "login" | "form" | "trial" | "subscribe" | "live";

export default function BroadcastPage() {
  // 仮の認証状態（Supabase接続後に実装）
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [trialUsed, setTrialUsed] = useState(false);

  const [sport, setSport] = useState("サッカー");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [tournament, setTournament] = useState("");
  const [venue, setVenue] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [copied, setCopied] = useState("");
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [periodIndex, setPeriodIndex] = useState(0);

  const periods = PERIODS[sport] || PERIODS["その他"];
  const currentPeriod = periods[periodIndex] || periods[0];

  const canStart = home.trim() && away.trim();
  const needsSubscription = !subscribed && trialUsed;

  // 画面の決定ロジック
  function getScreen(): Screen {
    if (!loggedIn) return "login";
    if (shareCode) return "live";
    return "form";
  }

  function handleStart() {
    if (!canStart || needsSubscription) return;
    const code = generateCode();
    setShareCode(code);
    if (!subscribed) setTrialUsed(true);
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  }

  const screen = getScreen();

  // ===== 未ログイン =====
  if (screen === "login") {
    return (
      <div className="mx-auto max-w-sm px-5 py-16 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-[#e63946]/10 flex items-center justify-center mb-6">
          <svg className="w-7 h-7 text-[#e63946]" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8" />
          </svg>
        </div>
        <h1 className="text-lg font-bold">配信するにはログインが必要です</h1>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          無料のアカウント登録で、初回10分間の配信を無料でお試しいただけます。
        </p>

        <div className="mt-8 space-y-2.5">
          <button
            onClick={() => setLoggedIn(true)}
            className="w-full flex items-center justify-center gap-3 bg-white text-black text-sm font-semibold py-3 rounded-md hover:bg-gray-200 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Googleでログイン
          </button>
          <button
            onClick={() => setLoggedIn(true)}
            className="w-full flex items-center justify-center gap-3 bg-[#06C755] text-white text-sm font-semibold py-3 rounded-md hover:bg-[#05b34c] transition"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z"/></svg>
            LINEでログイン
          </button>
          <button
            onClick={() => setLoggedIn(true)}
            className="w-full flex items-center justify-center gap-3 bg-[#1877F2] text-white text-sm font-semibold py-3 rounded-md hover:bg-[#1565c0] transition"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Facebookでログイン
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-gray-600">または</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <button
          onClick={() => setLoggedIn(true)}
          className="mt-5 w-full flex items-center justify-center gap-2 border border-white/10 text-gray-300 text-sm font-semibold py-3 rounded-md hover:bg-white/5 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          メールアドレスで新規登録
        </button>

        <p className="mt-3 text-[10px] text-gray-700">
          ※ デモのため、ボタンを押すとログイン状態になります
        </p>

        <div className="mt-8 rounded-md bg-[#111] border border-white/5 p-4 text-left">
          <p className="text-[11px] text-gray-400 font-medium mb-2">配信者プラン</p>
          <p className="text-lg font-black">¥300<span className="text-xs font-normal text-gray-500">/月</span></p>
          <p className="text-[10px] text-gray-500 mt-1">初回10分間は無料でお試し</p>
          <ul className="mt-2 space-y-1 text-[10px] text-gray-500">
            <li>✓ スコアボード・オーバーレイ</li>
            <li>✓ リモコンでスコア操作</li>
            <li>✓ 限定公開の共有コード発行</li>
            <li>✓ アーカイブ自動保存</li>
          </ul>
        </div>
      </div>
    );
  }

  // ===== 配信中（横画面フルスクリーン） =====
  if (screen === "live") {
    const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/watch/${shareCode}`;
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col landscape:flex-row">
        {/* カメラ映像エリア（横画面時フル幅） */}
        <div className="relative flex-1 bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
          <p className="text-xs text-gray-600">カメラ映像（LiveKit接続後に有効）</p>

          {/* 左上: スコアボード・オーバーレイ（視聴者に見える部分） */}
          <div className="absolute top-3 left-3 sm:top-4 sm:left-4 flex items-center">
            <div className="flex items-center bg-black/70 backdrop-blur-sm rounded overflow-hidden text-[10px] sm:text-xs">
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10">
                <span className="font-bold">{home}</span>
              </div>
              <div className="flex items-center gap-0.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-[#e63946]">
                <span className="font-black tabular-nums">{homeScore}</span>
                <span className="text-[8px] text-white/60">-</span>
                <span className="font-black tabular-nums">{awayScore}</span>
              </div>
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10">
                <span className="font-bold">{away}</span>
              </div>
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-black/60">
                <span className="tabular-nums font-medium">{currentPeriod}</span>
              </div>
            </div>
          </div>

          {/* スコア操作パネル（配信者のみ表示、視聴者には見えない） */}
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2">
            {/* ホーム得点 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-400 w-12 truncate text-right">{home}</span>
              <button
                onClick={() => setHomeScore(Math.max(0, homeScore - 1))}
                className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm font-bold transition active:scale-90"
              >
                −
              </button>
              <span className="text-lg font-black tabular-nums w-6 text-center">{homeScore}</span>
              <button
                onClick={() => setHomeScore(homeScore + 1)}
                className="w-7 h-7 rounded bg-[#e63946] hover:bg-[#d62836] flex items-center justify-center text-sm font-bold transition active:scale-90"
              >
                +
              </button>
            </div>

            <span className="text-gray-600 text-xs">|</span>

            {/* アウェイ得点 */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAwayScore(Math.max(0, awayScore - 1))}
                className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm font-bold transition active:scale-90"
              >
                −
              </button>
              <span className="text-lg font-black tabular-nums w-6 text-center">{awayScore}</span>
              <button
                onClick={() => setAwayScore(awayScore + 1)}
                className="w-7 h-7 rounded bg-[#e63946] hover:bg-[#d62836] flex items-center justify-center text-sm font-bold transition active:scale-90"
              >
                +
              </button>
              <span className="text-[9px] text-gray-400 w-12 truncate">{away}</span>
            </div>

            <span className="text-gray-600 text-xs">|</span>

            {/* ピリオド切替 */}
            <button
              onClick={() => setPeriodIndex(periodIndex > 0 ? periodIndex - 1 : 0)}
              className="w-6 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs transition active:scale-90"
            >
              ‹
            </button>
            <span className="text-[10px] font-medium w-10 text-center">{currentPeriod}</span>
            <button
              onClick={() => setPeriodIndex(periodIndex < periods.length - 1 ? periodIndex + 1 : periodIndex)}
              className="w-6 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs transition active:scale-90"
            >
              ›
            </button>
          </div>

          {/* 右上: 大会名 + LIVE + お試し表示 */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-1.5">
            {!subscribed && (
              <div className="bg-yellow-500/20 backdrop-blur-sm rounded px-2 py-1 text-[9px] text-yellow-500 font-medium">
                お試し 10分
              </div>
            )}
            {(tournament || sport) && (
              <div className="bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-[9px] sm:text-[10px] text-gray-300">
                {tournament || sport}
              </div>
            )}
            <div className="flex items-center gap-1 bg-[#e63946] px-2 py-1 rounded text-[9px] sm:text-[10px] font-bold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </div>
          </div>

          {/* 左下: 共有コード */}
          <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
            <button
              onClick={() => copyToClipboard(shareCode, "code")}
              className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded px-2 sm:px-3 py-1.5 transition hover:bg-black/90"
            >
              <span className="text-[9px] text-gray-400">共有コード</span>
              <span className="text-xs sm:text-sm font-black tracking-widest tabular-nums">{shareCode}</span>
              <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
            </button>
            {copied === "code" && (
              <p className="text-[9px] text-green-400 mt-1 ml-1">コピーしました</p>
            )}
          </div>

          {/* 右下: コントロールボタン群 */}
          <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 flex items-center gap-2">
            {/* LINEで共有 */}
            <button
              onClick={() => copyToClipboard(
                `【試合配信中】\n${home} vs ${away}\n${tournament ? tournament + "\n" : ""}視聴はこちら → ${shareUrl}`,
                "line"
              )}
              className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] rounded px-2 sm:px-3 py-1.5 transition"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z"/></svg>
              <span className="text-[10px] font-semibold">{copied === "line" ? "コピー済" : "LINE共有"}</span>
            </button>

            {/* サブスク案内（お試し時） */}
            {!subscribed && (
              <button
                onClick={() => setSubscribed(true)}
                className="flex items-center gap-1 bg-[#e63946] hover:bg-[#d62836] rounded px-2 sm:px-3 py-1.5 transition text-[10px] font-semibold"
              >
                プランに登録
              </button>
            )}

            {/* 配信終了 */}
            <button
              onClick={() => setShareCode("")}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20 rounded px-2 sm:px-3 py-1.5 transition"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
              </svg>
              <span className="text-[10px] text-gray-400 font-medium">終了</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== 入力フォーム（ログイン済み）=====
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 pb-20">
      <h1 className="text-lg font-bold">配信をはじめる</h1>
      <p className="mt-1 text-xs text-gray-500">
        試合情報を入力して配信を開始すると、共有コードが発行されます。
      </p>

      {/* サブスク必要の案内 */}
      {needsSubscription && (
        <div className="mt-4 rounded-lg border border-[#e63946]/30 bg-[#e63946]/5 p-4">
          <p className="text-xs text-[#e63946] font-medium">無料お試しは終了しました</p>
          <p className="text-[10px] text-gray-400 mt-1">
            配信を続けるには、配信者プラン（¥300/月）への登録が必要です。
          </p>
          <button
            onClick={() => setSubscribed(true)}
            className="mt-3 w-full bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 rounded-md transition"
          >
            配信者プランに登録（¥300/月）
          </button>
          <p className="mt-1 text-[9px] text-gray-600 text-center">
            ※ デモのため、ボタンを押すと契約状態になります
          </p>
        </div>
      )}

      <div className="mt-8 space-y-5">
        {/* 種目 */}
        <fieldset>
          <legend className="text-[11px] text-gray-400 font-medium mb-2">種目</legend>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setSport(s); setPeriodIndex(0); }}
                className={`text-xs px-3 py-1.5 rounded-md border transition ${
                  sport === s
                    ? "border-[#e63946] text-[#e63946] bg-[#e63946]/10"
                    : "border-white/10 text-gray-400 hover:border-white/20"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>

        {/* チーム */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] text-gray-400 font-medium">ホーム</label>
            <input
              type="text"
              placeholder="チーム名"
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-medium">アウェイ</label>
            <input
              type="text"
              placeholder="チーム名"
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
            />
          </div>
        </div>

        {/* 大会・会場 */}
        <div>
          <label className="text-[11px] text-gray-400 font-medium">大会名</label>
          <input
            type="text"
            placeholder="任意"
            value={tournament}
            onChange={(e) => setTournament(e.target.value)}
            className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-400 font-medium">会場</label>
          <input
            type="text"
            placeholder="任意"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
          />
        </div>

        {/* スコアボードプレビュー（TV中継風） */}
        <div>
          <p className="text-[11px] text-gray-400 font-medium mb-2">オーバーレイ プレビュー</p>
          <div className="rounded-md bg-[#111] border border-white/10 p-4 relative aspect-[16/9] overflow-hidden">
            <p className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-700">実際の配信画面イメージ</p>

            {/* 左上: スコアボード */}
            <div className="absolute top-3 left-3 flex items-center">
              <div className="flex items-center bg-black/80 backdrop-blur-sm rounded overflow-hidden text-[9px]">
                <div className="px-2 py-1 bg-white/10">
                  <span className="font-bold">{home || "ホーム"}</span>
                </div>
                <div className="flex items-center gap-0.5 px-2 py-1 bg-[#e63946]">
                  <span className="font-black tabular-nums">0</span>
                  <span className="text-[7px] text-white/60">-</span>
                  <span className="font-black tabular-nums">0</span>
                </div>
                <div className="px-2 py-1 bg-white/10">
                  <span className="font-bold">{away || "アウェイ"}</span>
                </div>
                <div className="px-2 py-1 bg-black/60">
                  <span className="tabular-nums font-medium">{periods[0]}</span>
                </div>
              </div>
            </div>

            {/* 右上: 大会名 + LIVE */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <div className="bg-black/80 backdrop-blur-sm rounded px-2 py-1 text-[8px] text-gray-300">
                {tournament || sport || "大会名"}
              </div>
              <div className="flex items-center gap-1 bg-[#e63946] px-1.5 py-1 rounded text-[8px] font-bold">
                <span className="w-1 h-1 bg-white rounded-full" />
                LIVE
              </div>
            </div>
          </div>
          <p className="mt-1.5 text-[9px] text-gray-600">
            視聴者にはこのようにスコアボードが映像の上にオーバーレイ表示されます
          </p>
        </div>

        {/* 配信ボタン */}
        <button
          disabled={!canStart || needsSubscription}
          onClick={handleStart}
          className="w-full bg-[#e63946] text-white text-sm font-semibold py-3 rounded-md transition mt-2 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-[#d62836]"
        >
          {!subscribed && !trialUsed
            ? "配信をスタート（10分間無料お試し）"
            : "配信をスタート"}
        </button>
        {!canStart && (
          <p className="text-center text-[10px] text-[#e63946]/60">
            ホーム・アウェイのチーム名を入力してください
          </p>
        )}
      </div>
    </div>
  );
}
