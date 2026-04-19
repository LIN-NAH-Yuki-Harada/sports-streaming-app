"use client";

import { useState } from "react";
import Link from "next/link";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });

      if (res.ok) {
        setSent(true);
      } else {
        setError("送信に失敗しました。もう一度お試しください。");
      }
    } catch {
      setError("送信に失敗しました。もう一度お試しください。");
    }
    setLoading(false);
  };

  return (
    <div className="mx-auto max-w-lg px-5 md:px-8 py-10 md:py-14 pb-24">
      <Link href="/" className="text-xs text-gray-500 hover:text-white transition">
        ← ホームに戻る
      </Link>

      <h1 className="text-lg font-bold mt-6">お問い合わせ</h1>
      <p className="mt-2 text-xs text-gray-500 leading-relaxed">
        ご質問・ご要望・不具合の報告など、お気軽にお問い合わせください。
      </p>

      {sent ? (
        <div className="mt-8 rounded-lg bg-[#111] border border-white/10 p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-bold">お問い合わせを受け付けました</p>
          <p className="mt-2 text-xs text-gray-400 leading-relaxed">
            内容を確認の上、ご返信いたします。
            <br />
            しばらくお待ちください。
          </p>
          <button
            onClick={() => { setSent(false); setName(""); setEmail(""); setMessage(""); }}
            className="mt-4 text-xs text-gray-400 hover:text-white transition"
          >
            新しいお問い合わせ
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-[11px] text-gray-400 font-medium">お名前</label>
            <input
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田太郎"
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-medium">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-medium">お問い合わせ内容</label>
            <textarea
              required
              maxLength={5000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="ご質問・ご要望・不具合の詳細をお書きください"
              rows={5}
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition resize-none"
            />
            <p className="mt-1 text-right text-[10px] text-gray-600">{message.length}/5,000</p>
          </div>
          {error && (
            <p className="text-xs text-[#e63946] bg-[#e63946]/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-2.5 rounded-md transition disabled:opacity-50"
          >
            {loading ? "送信中..." : "送信する"}
          </button>
          <p className="text-[10px] text-gray-600 text-center">
            直接メールでも受け付けています:
            <br />
            <span className="text-gray-400">lin.nah.yuki@gmail.com</span>
          </p>
        </form>
      )}
    </div>
  );
}
