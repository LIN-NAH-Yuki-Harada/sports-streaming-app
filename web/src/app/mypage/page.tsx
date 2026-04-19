"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
import { useToast } from "@/components/toaster";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase";
import { updateProfile } from "@/lib/database";

const PLAN_LABELS: Record<string, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン（¥300/月）",
  team: "チームプラン（¥500/月）",
};

// useSearchParams を使うため Suspense でラップしたインナーコンポーネントに分離
export default function MyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <MyPageInner />
    </Suspense>
  );
}

function MyPageInner() {
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unlinkingYoutube, setUnlinkingYoutube] = useState(false);

  // YouTube連携後・決済後のリダイレクト処理
  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      toast.info("決済が完了しました！プランを反映中です…");
      const t = setTimeout(() => {
        refreshProfile();
        toast.success("プランが有効になりました！");
      }, 2500);
      router.replace("/mypage");
      return () => clearTimeout(t);
    }
    if (checkout === "cancel") {
      toast.info("決済をキャンセルしました");
      router.replace("/mypage");
    }
    const youtube = searchParams.get("youtube");
    if (youtube === "linked") {
      refreshProfile();
      toast.success("YouTubeアカウントを連携しました！");
      router.replace("/mypage");
    }
    if (youtube === "cancelled") {
      toast.info("YouTube連携をキャンセルしました");
      router.replace("/mypage");
    }
    if (youtube === "error") {
      toast.error("YouTube連携でエラーが発生しました");
      router.replace("/mypage");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router, refreshProfile]);

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("セッションが無効です。再ログインしてください。");
        setDeleting(false);
        return;
      }
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        await signOut();
        window.location.href = "/";
      } else {
        toast.error("退会処理に失敗しました。もう一度お試しください。");
      }
    } catch {
      toast.error("退会処理でエラーが発生しました。");
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
  };

  const handleYoutubeLink = async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    try {
      const res = await fetch("/api/youtube/auth", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.authUrl) {
        window.location.href = json.authUrl;
      } else {
        toast.error(json.error || "YouTube連携の準備に失敗しました");
      }
    } catch {
      toast.error("YouTube連携の準備に失敗しました");
    }
  };

  const handleYoutubeUnlink = async () => {
    if (!confirm("YouTube連携を解除しますか？")) return;
    setUnlinkingYoutube(true);
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setUnlinkingYoutube(false); return; }
    try {
      await fetch("/api/youtube/unlink", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshProfile();
      toast.success("YouTube連携を解除しました");
    } catch {
      toast.error("連携解除に失敗しました");
    }
    setUnlinkingYoutube(false);
  };

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
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <div className="flex items-center justify-between">
          <Logo />
          <h1 className="text-sm font-bold text-gray-400">マイページ</h1>
        </div>
      </div>

      <div className="px-5 md:px-8 lg:px-10 pt-4 md:pt-8 pb-20">
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
                <p className="text-xs text-gray-600">
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
            <div className="flex items-center gap-3 md:gap-4 mb-8">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-[#e63946]/20 flex items-center justify-center text-[#e63946] text-sm md:text-lg font-bold shrink-0">
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
                      className="text-xs text-gray-500 whitespace-nowrap"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm md:text-base font-medium truncate">
                      {profile?.display_name || user.email}
                    </p>
                    <button
                      onClick={() => {
                        setNameInput(profile?.display_name || "");
                        setEditingName(true);
                      }}
                      className="text-xs text-gray-600 hover:text-gray-400"
                    >
                      編集
                    </button>
                  </div>
                )}
                {/* メールアドレス（表示名がある場合） */}
                {profile?.display_name && !editingName && (
                  <p className="text-xs text-gray-500 truncate">
                    {user.email}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-0.5">
                  {PLAN_LABELS[profile?.plan || "free"]}
                </p>
              </div>
            </div>

            {/* メニュー */}
            <div className="space-y-1 md:space-y-0 md:grid md:grid-cols-2 md:gap-x-6 lg:gap-x-8">
              {/* サブスクリプション（有効） */}
              <Link
                href="/pricing"
                className="flex items-center justify-between py-3 border-b border-white/5 text-sm hover:bg-white/5 transition -mx-2 px-2 rounded"
              >
                <span className="text-white">サブスクリプション</span>
                <span className="text-xs text-[#e63946] font-semibold">
                  {profile?.plan === "free" ? "プランを選ぶ →" : "プラン管理 →"}
                </span>
              </Link>

              {/* 配信履歴 */}
              <Link
                href="/schedule"
                className="flex items-center justify-between py-3 border-b border-white/5 text-sm hover:bg-white/5 transition -mx-2 px-2 rounded"
              >
                <span className="text-white">配信履歴</span>
                <span className="text-xs text-gray-400">→</span>
              </Link>

              {/* チーム */}
              <Link
                href="/search"
                className="flex items-center justify-between py-3 border-b border-white/5 text-sm hover:bg-white/5 transition -mx-2 px-2 rounded"
              >
                <span className="text-white">チーム管理</span>
                <span className="text-xs text-gray-400">→</span>
              </Link>

              {/* お問い合わせ */}
              <Link
                href="/contact"
                className="flex items-center justify-between py-3 border-b border-white/5 text-sm hover:bg-white/5 transition -mx-2 px-2 rounded"
              >
                <span className="text-white">お問い合わせ</span>
                <span className="text-xs text-gray-400">→</span>
              </Link>
            </div>

            {/* YouTube連携 */}
            <div className="mt-6 md:mt-8 rounded-lg border border-white/10 bg-[#111] p-4 md:p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <h3 className="text-sm font-semibold">YouTube連携</h3>
              </div>

              {profile?.plan !== "team" ? (
                <div>
                  <p className="text-xs text-gray-500">
                    配信のアーカイブをYouTubeに自動保存できます。
                  </p>
                  <p className="mt-2 text-xs text-[#e63946]">
                    チームプラン（¥500/月）で利用可能
                  </p>
                </div>
              ) : profile?.youtube_channel_id ? (
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-green-400 font-medium">連携済み</p>
                      <p className="text-sm text-white mt-0.5">{profile.youtube_channel_name}</p>
                    </div>
                    <button
                      onClick={handleYoutubeUnlink}
                      disabled={unlinkingYoutube}
                      className="text-xs text-gray-500 hover:text-red-400 transition disabled:opacity-50"
                    >
                      {unlinkingYoutube ? "解除中..." : "連携解除"}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-gray-500 mb-3">
                    YouTubeアカウントを連携すると、配信のアーカイブが自動でチャンネルに保存されます。
                  </p>
                  <button
                    onClick={handleYoutubeLink}
                    className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2.5 rounded-md transition"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    YouTubeアカウントを連携
                  </button>
                </div>
              )}
            </div>

            {/* ログアウトボタン */}
            <div className="md:max-w-sm md:mx-auto">
              <button
                onClick={signOut}
                className="mt-8 w-full border border-white/10 text-gray-400 text-sm py-2.5 rounded-md hover:bg-white/5 transition"
              >
                ログアウト
              </button>

              {/* 退会ボタン */}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="mt-3 w-full text-[11px] text-gray-600 hover:text-red-400 py-2 transition"
              >
                アカウントを削除（退会）
              </button>
            </div>

            {/* 退会確認ダイアログ */}
            {showDeleteConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-5">
                <div className="w-full max-w-sm rounded-xl bg-[#111] border border-white/10 p-6">
                  <h3 className="text-base font-bold text-center text-red-400">
                    本当に退会しますか？
                  </h3>
                  <p className="mt-3 text-xs text-gray-400 text-center leading-relaxed">
                    アカウントを削除すると、プロフィール・配信履歴などのすべてのデータが削除されます。この操作は取り消せません。
                  </p>
                  <div className="mt-6 space-y-2">
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                      className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2.5 rounded-md transition disabled:opacity-50"
                    >
                      {deleting ? "退会処理中..." : "退会する"}
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                      className="w-full border border-white/10 text-gray-400 text-sm py-2.5 rounded-md hover:bg-white/5 transition"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <p className="mt-8 text-center text-[10px] text-gray-700">
          LIVE SPOtCH v0.2.0 (MVP)
        </p>
      </div>
    </div>
  );
}
