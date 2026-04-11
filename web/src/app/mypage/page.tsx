"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
import { updateProfile } from "@/lib/database";

const PLAN_LABELS: Record<string, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン（¥300/月）",
  team: "チームプラン（¥500/月）",
};

export default function MyPage() {
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  const menuItems = [
    { label: "お気に入りチーム", ready: false },
    { label: "視聴履歴", ready: false },
    { label: "配信履歴", ready: false },
    { label: "サブスクリプション", ready: false },
    { label: "通知設定", ready: false },
    { label: "ヘルプ", ready: false },
  ];

  const handleSaveName = async () => {
    if (!user || !nameInput.trim()) return;
    setSaving(true);
    await updateProfile(user.id, { display_name: nameInput.trim() });
    await refreshProfile();
    setEditingName(false);
    setSaving(false);
  };

  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pt-4 pb-3">
        <h1 className="text-sm font-bold">マイページ</h1>
      </div>

      <div className="px-5 pt-4 pb-20">
        {/* 読み込み中 */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* 未ログイン: ログインフォーム表示 */}
        {!loading && !user && (
          <div className="max-w-sm mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center text-gray-600 text-sm">
                ?
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">
                  ログインしていません
                </p>
                <p className="text-[10px] text-gray-600">
                  ログインするとお気に入りチームや配信履歴が使えます
                </p>
              </div>
            </div>

            <AuthForm />
          </div>
        )}

        {/* ログイン済み: プロフィール表示 */}
        {!loading && user && (
          <>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-full bg-[#e63946]/20 flex items-center justify-center text-[#e63946] text-sm font-bold">
                {(profile?.display_name || user.email)?.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                {/* 表示名 */}
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="表示名を入力"
                      className="bg-[#111] border border-white/10 rounded px-2 py-1 text-sm text-white focus:border-[#e63946]/50 focus:outline-none w-full"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={saving || !nameInput.trim()}
                      className="text-[10px] text-[#e63946] font-medium whitespace-nowrap disabled:opacity-30"
                    >
                      {saving ? "保存中..." : "保存"}
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="text-[10px] text-gray-500 whitespace-nowrap"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {profile?.display_name || user.email}
                    </p>
                    <button
                      onClick={() => {
                        setNameInput(profile?.display_name || "");
                        setEditingName(true);
                      }}
                      className="text-[9px] text-gray-600 hover:text-gray-400"
                    >
                      編集
                    </button>
                  </div>
                )}
                {/* メールアドレス（表示名がある場合） */}
                {profile?.display_name && !editingName && (
                  <p className="text-[10px] text-gray-500 truncate">
                    {user.email}
                  </p>
                )}
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {PLAN_LABELS[profile?.plan || "free"]}
                </p>
              </div>
            </div>

            {/* メニュー */}
            <div className="space-y-1">
              {menuItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between py-3 border-b border-white/5 text-sm"
                >
                  <span className="text-gray-400">{item.label}</span>
                  <span className="text-[10px] text-gray-700">準備中</span>
                </div>
              ))}
            </div>

            {/* ログアウトボタン */}
            <button
              onClick={signOut}
              className="mt-8 w-full border border-white/10 text-gray-400 text-sm py-2.5 rounded-md hover:bg-white/5 transition"
            >
              ログアウト
            </button>
          </>
        )}

        <p className="mt-8 text-center text-[10px] text-gray-700">
          LIVE SPOtCH v0.2.0 (MVP)
        </p>
      </div>
    </div>
  );
}
