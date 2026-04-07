"use client";

import { useState } from "react";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];

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

        <button
          onClick={() => setLoggedIn(true)}
          className="mt-8 w-full bg-white text-black text-sm font-semibold py-3 rounded-md hover:bg-gray-200 transition"
        >
          ログイン / 新規登録
        </button>
        <p className="mt-2 text-[10px] text-gray-700">
          ※ デモのため、ボタンを押すとログイン状態になります
        </p>

        <div className="mt-8 rounded-md bg-[#111] border border-white/5 p-4 text-left">
          <p className="text-[11px] text-gray-400 font-medium mb-2">配信者プラン</p>
          <p className="text-lg font-black">¥200<span className="text-xs font-normal text-gray-500">/月</span></p>
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

  // ===== 配信中 =====
  if (screen === "live") {
    const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/watch/${shareCode}`;
    return (
      <div className="mx-auto max-w-2xl px-5 py-10 pb-20">
        {/* ステータス */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e63946] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e63946]" />
            </span>
            <span className="text-sm font-semibold">配信中</span>
          </div>
          {!subscribed && (
            <div className="flex items-center gap-1 text-[10px] text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">
              <span>お試し配信（10分間）</span>
            </div>
          )}
        </div>

        {/* スコアボード */}
        <div className="rounded-md bg-black px-4 py-3 mb-4">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
            <span>{tournament || sport}</span>
            <span className="text-[#e63946]">LIVE</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold flex-1">{home}</span>
            <div className="text-center mx-4">
              <span className="text-2xl font-black tabular-nums">0 - 0</span>
              <p className="text-[10px] text-gray-500">前半 00:00</p>
            </div>
            <span className="text-sm font-semibold flex-1 text-right">{away}</span>
          </div>
        </div>

        {/* 映像プレビュー */}
        <div className="aspect-[16/9] bg-[#111] rounded-md border border-white/5 flex items-center justify-center mb-6">
          <p className="text-xs text-gray-600">カメラ映像（LiveKit接続後に有効）</p>
        </div>

        {/* 共有セクション */}
        <div className="rounded-lg bg-[#111] border border-white/5 p-4 mb-4">
          <h3 className="text-xs font-semibold text-gray-300 mb-3">
            このコードを視聴者に共有してください
          </h3>

          <div className="flex items-center justify-between bg-black rounded-md px-4 py-3 mb-3">
            <span className="text-2xl font-black tracking-[0.3em] tabular-nums">
              {shareCode}
            </span>
            <button
              onClick={() => copyToClipboard(shareCode, "code")}
              className="text-xs text-gray-400 hover:text-white transition px-3 py-1 rounded bg-white/5"
            >
              {copied === "code" ? "コピーしました" : "コピー"}
            </button>
          </div>

          <div className="flex items-center gap-2 bg-black rounded-md px-3 py-2 mb-3">
            <span className="text-[11px] text-gray-500 truncate flex-1">{shareUrl}</span>
            <button
              onClick={() => copyToClipboard(shareUrl, "url")}
              className="text-[10px] text-gray-400 hover:text-white transition px-2 py-0.5 rounded bg-white/5 shrink-0"
            >
              {copied === "url" ? "コピー済" : "コピー"}
            </button>
          </div>

          <button
            onClick={() => copyToClipboard(
              `【試合配信中】\n${home} vs ${away}\n${tournament ? tournament + "\n" : ""}視聴はこちら → ${shareUrl}`,
              "line"
            )}
            className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-semibold py-2.5 rounded-md transition"
          >
            {copied === "line" ? "メッセージをコピーしました" : "LINEで共有するメッセージをコピー"}
          </button>
        </div>

        {/* お試し配信の場合：サブスク案内 */}
        {!subscribed && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 mb-4">
            <p className="text-xs text-yellow-500 font-medium">お試し配信中（10分間）</p>
            <p className="text-[10px] text-gray-400 mt-1">
              10分経過後も配信を続けるには、配信者プラン（¥200/月）への登録が必要です。
            </p>
            <button
              onClick={() => setSubscribed(true)}
              className="mt-3 w-full bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2 rounded-md transition"
            >
              配信者プランに登録（¥200/月）
            </button>
            <p className="mt-1 text-[9px] text-gray-600 text-center">
              ※ デモのため、ボタンを押すと契約状態になります
            </p>
          </div>
        )}

        <button
          onClick={() => {
            setShareCode("");
          }}
          className="w-full border border-gray-700 text-gray-400 text-sm py-2.5 rounded-md hover:bg-white/5 transition"
        >
          配信を終了する
        </button>
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
            配信を続けるには、配信者プラン（¥200/月）への登録が必要です。
          </p>
          <button
            onClick={() => setSubscribed(true)}
            className="mt-3 w-full bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 rounded-md transition"
          >
            配信者プランに登録（¥200/月）
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
                onClick={() => setSport(s)}
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

        {/* スコアボードプレビュー */}
        <div>
          <p className="text-[11px] text-gray-400 font-medium mb-2">スコアボード プレビュー</p>
          <div className="rounded-md bg-[#111] border border-white/10 p-3">
            <div className="bg-black rounded px-4 py-2.5">
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>{tournament || "大会名"}</span>
                <span className="text-[#e63946]">LIVE</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex-1">{home || "ホーム"}</span>
                <div className="text-center mx-4">
                  <span className="text-xl font-black tabular-nums">0 - 0</span>
                  <p className="text-[10px] text-gray-500">前半 00:00</p>
                </div>
                <span className="text-sm font-semibold flex-1 text-right">{away || "アウェイ"}</span>
              </div>
            </div>
          </div>
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
