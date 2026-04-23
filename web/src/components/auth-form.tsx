"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

type Mode = "login" | "signup" | "reset";

function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

type AuthFormProps = {
  /**
   * ログイン・新規登録成功後の遷移先（Google OAuth と メール新規登録の確認メール両方で使う）。
   * 省略時は `/mypage`。
   */
  redirectTo?: string;
};

export function AuthForm({ redirectTo }: AuthFormProps = {}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // redirectTo は「/pricing?promo=SPOT1W」等の相対パスで来ることもあるため、絶対URLに展開する
  const successUrl = redirectTo
    ? redirectTo.startsWith("http")
      ? redirectTo
      : `${getSiteUrl()}${redirectTo.startsWith("/") ? "" : "/"}${redirectTo}`
    : `${getSiteUrl()}/mypage`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();

    if (mode === "reset") {
      // --- パスワードリセット ---
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteUrl()}/reset-password`,
      });
      if (error) {
        setError(error.message);
      } else {
        setSent(true);
      }
    } else if (mode === "signup") {
      // --- 新規登録 ---
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: successUrl,
        },
      });
      if (error) {
        setError(error.message);
      } else {
        setSent(true);
      }
    } else {
      // --- ログイン ---
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "メールアドレスまたはパスワードが正しくありません"
            : error.message
        );
      }
      // ログイン成功 → AuthProvider が自動検知して画面が切り替わる
    }

    setLoading(false);
  }

  async function handleGoogleLogin() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: successUrl,
      },
    });
  }

  // メール送信済み画面（新規登録 or パスワードリセット）
  if (sent) {
    const isReset = mode === "reset";
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm font-bold">
          {isReset ? "パスワードリセットメールを送信しました" : "確認メールを送信しました"}
        </p>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          <span className="text-white font-medium">{email}</span> にメールを送りました。
          <br />
          {isReset
            ? "メール内のリンクからパスワードを再設定してください。"
            : "メール内のリンクをクリックして登録を完了してください。"}
        </p>
        <button
          onClick={() => { setSent(false); setMode("login"); }}
          className="mt-6 text-xs text-[#e63946] hover:underline"
        >
          ログイン画面に戻る
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* ソーシャルログインボタン */}
      <div className="space-y-2.5">
        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white text-black text-sm font-semibold py-2.5 rounded-md hover:bg-gray-200 transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Googleでログイン
        </button>
      </div>

      {/* 区切り線 */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-[10px] text-gray-600">または</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* メール認証フォーム */}
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        {mode === "reset" && (
          <p className="text-xs text-gray-400 leading-relaxed">
            登録済みのメールアドレスを入力してください。パスワード再設定用のリンクをお送りします。
          </p>
        )}
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
        {mode !== "reset" && (
          <div>
            <label className="text-[11px] text-gray-400 font-medium">パスワード</label>
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
        )}

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
          {loading
            ? "処理中..."
            : mode === "reset"
              ? "リセットメールを送信"
              : mode === "signup"
                ? "新規登録"
                : "ログイン"}
        </button>
      </form>

      {/* パスワードリセットリンク（ログインモード時のみ） */}
      {mode === "login" && (
        <p className="mt-2 text-center">
          <button
            onClick={() => { setMode("reset"); setError(""); }}
            className="text-[10px] text-gray-500 hover:text-gray-400"
          >
            パスワードをお忘れですか？
          </button>
        </p>
      )}

      {/* モード切り替え */}
      <p className="mt-4 text-center text-xs text-gray-500">
        {mode === "login" ? (
          <>
            アカウントをお持ちでない方は{" "}
            <button
              onClick={() => { setMode("signup"); setError(""); }}
              className="text-[#e63946] hover:underline"
            >
              新規登録
            </button>
          </>
        ) : (
          <>
            アカウントをお持ちの方は{" "}
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className="text-[#e63946] hover:underline"
            >
              ログイン
            </button>
          </>
        )}
      </p>
    </div>
  );
}
