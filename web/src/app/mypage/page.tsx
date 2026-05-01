"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
import { PlanTeaser } from "@/components/plan-teaser";
import { useToast } from "@/components/toaster";
import { Logo } from "@/components/logo";
import { AvatarUploader } from "@/components/avatar-uploader";
import { createClient } from "@/lib/supabase";
import { updateProfile } from "@/lib/database";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";

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
  const [linkingYoutube, setLinkingYoutube] = useState(false);
  const [togglingLive, setTogglingLive] = useState(false);
  const archiveFeatureLive = isArchiveEnabled();
  const liveArchiveLive = isLiveArchiveEnabled();

  // YouTube連携後・決済後のリダイレクト処理
  const handledCheckoutRef = useRef<string | null>(null);
  const handledYoutubeRef = useRef<string | null>(null);
  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success" && handledCheckoutRef.current !== "success") {
      handledCheckoutRef.current = "success";
      toast.info("決済が完了しました！プランを反映中です…");
      const t = setTimeout(() => {
        refreshProfile();
        toast.success("プランが有効になりました！");
      }, 2500);
      router.replace("/mypage");
      return () => clearTimeout(t);
    }
    if (checkout === "cancel" && handledCheckoutRef.current !== "cancel") {
      handledCheckoutRef.current = "cancel";
      toast.info("決済をキャンセルしました");
      router.replace("/mypage");
    }
    const youtube = searchParams.get("youtube");
    if (youtube === "linked" && handledYoutubeRef.current !== "linked") {
      handledYoutubeRef.current = "linked";
      refreshProfile();
      toast.success("YouTubeアカウントを連携しました！");
      router.replace("/mypage");
    }
    if (youtube === "cancelled" && handledYoutubeRef.current !== "cancelled") {
      handledYoutubeRef.current = "cancelled";
      toast.info("YouTube連携をキャンセルしました");
      router.replace("/mypage");
    }
    if (youtube === "error" && handledYoutubeRef.current !== "error") {
      handledYoutubeRef.current = "error";
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
    setLinkingYoutube(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("セッションが無効です。再ログインしてください。");
        setLinkingYoutube(false);
        return;
      }
      const res = await fetch("/api/youtube/auth", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error || "YouTube連携の準備に失敗しました");
        setLinkingYoutube(false);
        return;
      }
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch {
      toast.error("YouTube連携でエラーが発生しました");
      setLinkingYoutube(false);
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

  const handleToggleLive = async (next: boolean) => {
    if (!user) return;
    setTogglingLive(true);
    const result = await updateProfile(user.id, { youtube_live_enabled: next });
    if (result) {
      await refreshProfile();
      toast.success(next ? "YouTube 同時配信を有効にしました" : "YouTube 同時配信を無効にしました");
    } else {
      toast.error("設定の更新に失敗しました");
    }
    setTogglingLive(false);
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

            <PlanTeaser contextLabel="3つのプランから選べます" />
          </div>
        )}

        {/* ログイン済み: プロフィール表示 */}
        {!loading && user && (
          <>
            <div className="flex items-center gap-3 md:gap-4 mb-8">
              <AvatarUploader
                userId={user.id}
                avatarUrl={profile?.avatar_url ?? null}
                fallbackChar={(profile?.display_name || user.email)?.charAt(0).toUpperCase() || "U"}
                onUpdated={refreshProfile}
                size="md"
              />
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
            <div className="mt-6 md:mt-8 rounded-lg border border-[#e63946]/20 bg-gradient-to-br from-[#e63946]/5 to-transparent p-4 md:p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-[#e63946]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <h3 className="text-sm font-semibold text-white">YouTube自動アーカイブ</h3>
                {!archiveFeatureLive && (
                  <span className="text-[10px] text-[#e63946] bg-[#e63946]/10 border border-[#e63946]/30 rounded px-1.5 py-0.5 font-semibold">近日公開</span>
                )}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                <span className="text-white font-medium">チームプラン特典</span> — 配信終了後、試合映像をあなたのYouTubeチャンネルに限定公開で自動保存します。
              </p>
              <ul className="mt-3 space-y-1 text-[11px] text-gray-500">
                <li>・ストレージ容量を気にせず試合を保存</li>
                <li>・チャンネルが育ち、チームの記録が資産に</li>
                <li>・限定公開のため、URLを知る人のみ視聴可能</li>
              </ul>
              {profile?.youtube_channel_id ? (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <p className="text-[11px] text-gray-500">
                    連携中の YouTube アカウント:{" "}
                    <span className="text-gray-400">{profile.youtube_channel_name}</span>
                  </p>
                  <button
                    onClick={handleYoutubeUnlink}
                    disabled={unlinkingYoutube}
                    className="mt-2 text-[11px] text-gray-500 hover:text-red-400 transition disabled:opacity-50 underline"
                  >
                    {unlinkingYoutube ? "解除中..." : "連携を解除する"}
                  </button>
                </div>
              ) : archiveFeatureLive ? (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <button
                    onClick={handleYoutubeLink}
                    disabled={linkingYoutube || profile?.plan !== "team"}
                    className="w-full bg-[#e63946] hover:bg-[#c92a3a] text-white text-xs font-semibold py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {linkingYoutube
                      ? "Google認証画面へ移動中..."
                      : profile?.plan === "team"
                        ? "YouTubeアカウントと連携する"
                        : "チームプランで利用できます"}
                  </button>
                </div>
              ) : null}
            </div>

            {/* Live 中継機能（YouTube 同時配信）— PR-5 */}
            {liveArchiveLive && (
              <div className="mt-4 md:mt-5 rounded-lg border border-[#e63946]/20 bg-gradient-to-br from-[#e63946]/5 to-transparent p-4 md:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-[#e63946]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="2" fill="currentColor" />
                    <path d="M5.6 9a8 8 0 0 0 0 6M18.4 9a8 8 0 0 1 0 6" />
                  </svg>
                  <h3 className="text-sm font-semibold text-white">YouTube 同時配信（Live 中継）</h3>
                  <span className="text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1.5 py-0.5 font-semibold">ベータ</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  <span className="text-white font-medium">チームプラン特典</span> — 配信中、自社プレイヤー（リアルタイム配信）と並行で YouTube Live にもリアルタイム push します。配信終了後、自動的に YouTube アーカイブが残ります。
                </p>
                <ul className="mt-3 space-y-1 text-[11px] text-gray-500">
                  <li>・自社プレイヤー: 0.25 秒遅延（リアルタイム性重視）</li>
                  <li>・YouTube Live: 5-15 秒遅延（拡散性 + アーカイブ性重視）</li>
                  <li>・限定公開（unlisted）— URL を知る人のみ視聴可能</li>
                </ul>
                {profile?.plan !== "team" ? (
                  <p className="mt-3 pt-3 border-t border-white/5 text-[11px] text-gray-500">
                    🔒 チームプランで利用できます
                  </p>
                ) : !profile?.youtube_channel_id ? (
                  <p className="mt-3 pt-3 border-t border-white/5 text-[11px] text-gray-500">
                    🔗 先に上の YouTube アカウント連携を行ってください
                  </p>
                ) : (
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                    <span className="text-xs text-gray-300">配信時に YouTube Live を同時起動する</span>
                    <button
                      onClick={() => handleToggleLive(!profile.youtube_live_enabled)}
                      disabled={togglingLive}
                      role="switch"
                      aria-checked={profile.youtube_live_enabled}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
                        profile.youtube_live_enabled ? "bg-[#e63946]" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          profile.youtube_live_enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            )}

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
