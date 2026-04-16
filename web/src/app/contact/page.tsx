"use client";

import { useState } from "react";
import Link from "next/link";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // mailto リンクで送信（バックエンド不要）
    const subject = encodeURIComponent(`【LIVE SPOtCH】お問い合わせ: ${name}`);
    const body = encodeURIComponent(
      `お名前: ${name}\nメールアドレス: ${email}\n\n${message}`
    );
    window.location.href = `mailto:lin.nah.yuki@gmail.com?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-lg px-5 py-10 pb-24">
      <Link href="/" className="text-xs text-gray-500 hover:text-white transition">
        ← ホームに戻る
      </Link>

      <h1 className="text-lg font-bold mt-6">お問い合わせ</h1>
      <p className="mt-2 text-xs text-gray-500 leading-relaxed">
        ご質問・ご要望・不具合の報告など、お気軽にお問い合わせください。
      </p>

      {sent ? (
        <div className="mt-8 rounded-lg bg-[#111] border border-white/10 p-6 text-center">
          <p className="text-sm font-bold">メールアプリが開きます</p>
          <p className="mt-2 text-xs text-gray-400 leading-relaxed">
            メールアプリから送信を完了してください。
            <br />
            メールアプリが開かない場合は、以下のアドレスに直接お送りください。
          </p>
          <p className="mt-3 text-sm text-[#e63946] font-mono">lin.nah.yuki@gmail.com</p>
          <button
            onClick={() => setSent(false)}
            className="mt-4 text-xs text-gray-400 hover:text-white transition"
          >
            フォームに戻る
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-[11px] text-gray-400 font-medium">お名前</label>
            <input
              type="text"
              required
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
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="ご質問・ご要望・不具合の詳細をお書きください"
              rows={5}
              className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition resize-none"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-2.5 rounded-md transition"
          >
            送信する
          </button>
          <p className="text-[10px] text-gray-600 text-center">
            メールアプリが起動します。直接メールでも受け付けています:
            <br />
            <span className="text-gray-400">lin.nah.yuki@gmail.com</span>
          </p>
        </form>
      )}
    </div>
  );
}
