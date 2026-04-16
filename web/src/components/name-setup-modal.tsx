"use client";

import { useState } from "react";
import { updateProfile } from "@/lib/database";
import { useAuth } from "./auth-provider";

/**
 * display_name が未設定のユーザーに名前入力を促すモーダル。
 * AuthProvider の中で描画し、名前が空なら全画面をブロックする。
 */
export function NameSetupModal() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 表示条件: ログイン済み & プロフィール取得済み & display_name が空
  if (loading || !user || !profile) return null;
  if (profile.display_name && profile.display_name.trim() !== "") return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名前を入力してください");
      return;
    }
    if (trimmed.length > 30) {
      setError("30文字以内で入力してください");
      return;
    }

    setSaving(true);
    setError("");

    const result = await updateProfile(user.id, { display_name: trimmed });
    if (result) {
      await refreshProfile();
    } else {
      setError("保存に失敗しました。もう一度お試しください。");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-xl p-6">
        <h2 className="text-base font-bold text-center">ようこそ！</h2>
        <p className="mt-2 text-xs text-gray-400 text-center leading-relaxed">
          はじめに、あなたの名前を設定してください。
          <br />
          チームメンバーや他のユーザーに表示されます。
        </p>

        <div className="mt-5">
          <label className="text-[10px] text-gray-500 block mb-1">表示名</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="例: 田中太郎"
            maxLength={30}
            autoFocus
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder:text-gray-700 focus:border-[#e63946]/50 focus:outline-none transition"
          />
          {error && (
            <p className="mt-1 text-[10px] text-[#e63946]">{error}</p>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving || !name.trim()}
          className="mt-4 w-full bg-[#e63946] text-white text-sm font-semibold py-2.5 rounded-md transition disabled:opacity-40 hover:enabled:bg-[#d62836]"
        >
          {saving ? "保存中..." : "はじめる"}
        </button>

        <p className="mt-3 text-[9px] text-gray-600 text-center">
          名前はマイページからいつでも変更できます
        </p>
      </div>
    </div>
  );
}
