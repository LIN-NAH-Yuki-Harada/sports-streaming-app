"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { Logo } from "@/components/logo";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("パスワードは6文字以上で入力してください");
      return;
    }
    if (password !== confirm) {
      setError("パスワードが一致しません");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
          <Logo />
        </div>
        <div className="mx-auto max-w-sm md:max-w-md px-5 md:px-8 py-16 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-bold">パスワードを再設定しました</p>
          <p className="mt-2 text-xs text-gray-500">新しいパスワードでログインできます。</p>
          <a
            href="/"
            className="mt-6 inline-block bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-6 py-2.5 rounded-md transition"
          >
            ホームへ
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <Logo />
      </div>
      <div className="mx-auto max-w-sm md:max-w-md px-5 md:px-8 py-16">
      <h1 className="text-lg md:text-xl font-bold text-center">パスワード再設定</h1>
      <p className="mt-2 text-xs text-gray-500 text-center">新しいパスワードを入力してください。</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label className="text-[11px] text-gray-400 font-medium">新しいパスワード</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6文字以上"
            className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-400 font-medium">パスワード確認</label>
          <input
            type="password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="もう一度入力"
            className="mt-1 w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition"
          />
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
          {loading ? "処理中..." : "パスワードを再設定"}
        </button>
      </form>
      </div>
    </div>
  );
}
