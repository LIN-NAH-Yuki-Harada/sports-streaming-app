"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
import { PlanTeaser } from "@/components/plan-teaser";
import { useToast } from "@/components/toaster";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase";
import { getTeamBroadcastHistory, type Broadcast } from "@/lib/database";
import Link from "next/link";
import Image from "next/image";

type TeamMemberProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

type TeamMember = {
  id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  profiles: TeamMemberProfile;
};

type Team = {
  id: string;
  name: string;
  sport: string;
  description: string | null;
  invite_code: string | null;
  owner_id: string;
  created_at: string;
  team_members: TeamMember[];
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

const SPORT_EMOJI: Record<string, string> = {
  "サッカー": "⚽",
  "野球": "⚾",
  "バスケ": "🏀",
  "バレー": "🏐",
  "陸上": "🏃",
  "テニス": "🎾",
  "卓球": "🏓",
  "水泳": "🏊",
  "ラグビー": "🏉",
  "ハンドボール": "🤾",
};

function getSportEmoji(sport: string) {
  return SPORT_EMOJI[sport] || "🏆";
}

const ROLE_LABELS: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

export default function TeamPage() {
  return (
    <Suspense fallback={<div className="px-5 py-10 text-sm text-gray-500">読み込み中...</div>}>
      <TeamPageInner />
    </Suspense>
  );
}

function TeamPageInner() {
  const { user, profile, loading } = useAuth();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [tab, setTab] = useState<"list" | "create" | "join">("list");
  const [detailTab, setDetailTab] = useState<"members" | "history" | "settings">("members");
  const [teamBroadcasts, setTeamBroadcasts] = useState<Broadcast[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // フォーム状態
  const [createForm, setCreateForm] = useState({ name: "", sport: "サッカー", description: "" });
  const [joinCode, setJoinCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 編集状態
  const [editForm, setEditForm] = useState({ name: "", sport: "", description: "" });
  const [editing, setEditing] = useState(false);

  const getToken = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }, []);

  const fetchTeams = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoadingTeams(true);
    try {
      const res = await fetch("/api/teams", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTeams(data.teams || []);
    } catch {
      toast.error("チームの取得に失敗しました。通信状況を確認してください。");
    } finally {
      setLoadingTeams(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (user) fetchTeams();
  }, [user, fetchTeams]);

  // URL クエリ `?invite=XXX` で届いたら「招待コードで参加」タブに自動切替 + コード自動入力
  useEffect(() => {
    const inviteParam = searchParams.get("invite");
    if (inviteParam) {
      const normalized = inviteParam.trim().toUpperCase();
      setJoinCode(normalized);
      setTab("join");
    }
    // searchParams 変更時のみ発火、joinCode/tab の外部変更で再実行したくない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 試合履歴タブを開いたらチームの配信履歴を取得
  useEffect(() => {
    if (!selectedTeam || detailTab !== "history") return;
    setLoadingHistory(true);
    getTeamBroadcastHistory(selectedTeam.id)
      .then(setTeamBroadcasts)
      .finally(() => setLoadingHistory(false));
  }, [selectedTeam, detailTab]);

  // チーム作成
  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "エラーが発生しました");
        return;
      }
      toast.success(`「${data.team.name}」を作成しました！`);
      setCreateForm({ name: "", sport: "サッカー", description: "" });
      setTab("list");
      fetchTeams();
    } catch {
      toast.error("エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  // 招待コードで参加
  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/teams/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inviteCode: joinCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "エラーが発生しました");
        return;
      }
      if (data.alreadyMember) {
        toast.info("既にこのチームに参加しています");
      } else {
        toast.success(`「${data.team.name}」に参加しました！`);
      }
      setJoinCode("");
      setTab("list");
      fetchTeams();
    } catch {
      toast.error("エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  // チーム更新
  const handleUpdate = async () => {
    if (!selectedTeam || !editForm.name.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/teams/${selectedTeam.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "エラーが発生しました");
        return;
      }
      toast.success("チーム情報を更新しました");
      setEditing(false);
      fetchTeams();
      // 選択中のチームも更新
      setSelectedTeam((prev) =>
        prev ? { ...prev, name: editForm.name, sport: editForm.sport, description: editForm.description || null } : null
      );
    } catch {
      toast.error("エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  // チーム削除
  const handleDelete = async () => {
    if (!selectedTeam) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/teams/${selectedTeam.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "エラーが発生しました");
        return;
      }
      toast.success("チームを削除しました");
      setSelectedTeam(null);
      fetchTeams();
    } catch {
      toast.error("エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  // メンバー削除
  const handleRemoveMember = async (userId: string) => {
    if (!selectedTeam) return;
    if (!confirm("このメンバーを削除しますか？")) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/teams/${selectedTeam.id}/members`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "エラーが発生しました");
        return;
      }
      toast.success("メンバーを削除しました");
      fetchTeams();
      // 選択中チームのメンバーを更新
      setSelectedTeam((prev) =>
        prev
          ? { ...prev, team_members: prev.team_members.filter((m) => m.user_id !== userId) }
          : null
      );
    } catch {
      toast.error("エラーが発生しました");
    }
  };

  // ロール変更
  const handleRoleChange = async (userId: string, newRole: "admin" | "member") => {
    if (!selectedTeam) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/teams/${selectedTeam.id}/members`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "エラーが発生しました");
        return;
      }
      toast.success(`ロールを${ROLE_LABELS[newRole]}に変更しました`);
      fetchTeams();
      setSelectedTeam((prev) =>
        prev
          ? {
              ...prev,
              team_members: prev.team_members.map((m) =>
                m.user_id === userId ? { ...m, role: newRole } : m
              ),
            }
          : null
      );
    } catch {
      toast.error("エラーが発生しました");
    }
  };

  // ローディング
  if (loading) {
    return <div className="min-h-screen" />;
  }

  // 未ログイン
  if (!user) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
          <div className="flex items-center justify-between">
            <Logo />
            <h1 className="text-sm font-bold text-gray-400">チーム</h1>
          </div>
        </div>
        <div className="px-5 md:px-8 lg:px-10 pt-8 pb-20 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h2 className="text-base font-bold">チームチャンネル</h2>
          <p className="mt-2 text-xs text-gray-500 leading-relaxed">
            ログインすると、あなたのチームの
            <br />
            アーカイブやスケジュールを確認できます。
          </p>
          <div className="mt-6 text-left max-w-sm mx-auto">
            <AuthForm />
            <PlanTeaser
              contextLabel="チーム管理はチームプラン（¥500/月）から"
              highlight="team"
            />
          </div>
        </div>
      </div>
    );
  }

  // チーム詳細画面
  if (selectedTeam) {
    const isOwner = selectedTeam.owner_id === user.id;
    const myMembership = selectedTeam.team_members.find((m) => m.user_id === user.id);
    const isAdmin = myMembership?.role === "owner" || myMembership?.role === "admin";

    return (
      <div>
        <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
          <div className="flex items-center justify-between gap-3">
            <Logo />
            <button
              onClick={() => { setSelectedTeam(null); setEditing(false); }}
              className="text-xs text-gray-400 hover:text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e63946] rounded"
              aria-label="チーム一覧へ戻る"
            >
              ← チーム一覧
            </button>
          </div>
          <h1 className="mt-2 text-sm font-bold text-gray-400 truncate">{selectedTeam.name}</h1>
        </div>

        <div className="px-5 md:px-8 lg:px-10 pb-20">
          {/* チーム情報ヘッダー */}
          <div className="flex items-center gap-3 mt-4 mb-2">
            <div className="w-11 h-11 rounded-full bg-[#e63946]/10 flex items-center justify-center">
              <span className="text-lg">{getSportEmoji(selectedTeam.sport)}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{selectedTeam.name}</p>
              <p className="text-[10px] text-gray-500">
                {selectedTeam.sport} / メンバー {selectedTeam.team_members.length}人
              </p>
            </div>
          </div>
          {selectedTeam.description && (
            <p className="text-[11px] text-gray-400 mb-4">{selectedTeam.description}</p>
          )}

          {/* 招待コード */}
          {isAdmin && selectedTeam.invite_code && (() => {
            const inviteUrl = `${SITE_URL}/search?invite=${selectedTeam.invite_code}`;
            const inviteMsg = `🏆 「${selectedTeam.name}」のチームに招待します！\n\n下記のリンクを開くと、招待コードが自動で入力されます 👇\n${inviteUrl}\n\n（招待コード: ${selectedTeam.invite_code}）\n\n— LIVE SPOtCH\n${SITE_URL}`;
            return (
              <div className="rounded-lg bg-[#111] border border-white/5 p-3 mb-4">
                <p className="text-[10px] text-gray-500 mb-1">招待コード（下のボタンでメンバーに送信してください）</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono font-bold text-[#e63946] tracking-wider">
                    {selectedTeam.invite_code}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(inviteMsg);
                      toast.success("招待メッセージをコピーしました");
                    }}
                    className="text-[10px] text-gray-400 hover:text-white border border-white/10 rounded px-2 py-0.5"
                  >
                    メッセージをコピー
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-gray-600 leading-relaxed">
                  コピーには「チーム名・参加用URL・招待コード」が含まれます。LINE・メール・SMS などに貼り付けて送信してください。
                </p>
                <a
                  href={`https://line.me/R/msg/text/?${encodeURIComponent(inviteMsg)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-[#06C755] hover:bg-[#05b64c] text-white text-xs font-semibold py-2 rounded-md transition"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z"/></svg>
                  LINEで招待を送る
                </a>
              </div>
            );
          })()}

          {/* タブ */}
          <div className="flex gap-1 mb-4">
            {([
              { key: "members" as const, label: "メンバー" },
              { key: "history" as const, label: "試合履歴" },
              ...(isOwner ? [{ key: "settings" as const, label: "設定" }] : []),
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setDetailTab(t.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition ${
                  detailTab === t.key
                    ? "bg-white/10 text-white"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* メンバー一覧 */}
          {detailTab === "members" && (
            <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-3">
              {selectedTeam.team_members
                .sort((a, b) => {
                  const order = { owner: 0, admin: 1, member: 2 };
                  return order[a.role] - order[b.role];
                })
                .map((member) => (
                  <div key={member.id} className="flex items-center gap-3 rounded-md bg-[#111] border border-white/5 px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs overflow-hidden">
                      {member.profiles?.avatar_url ? (
                        <Image
                          src={member.profiles.avatar_url}
                          alt={member.profiles.display_name || "メンバー"}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <span>{(member.profiles?.display_name || "?")[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {member.profiles?.display_name || "名前未設定"}
                      </p>
                      <p className="text-[10px] text-gray-500">{ROLE_LABELS[member.role]}</p>
                    </div>
                    {/* オーナーがメンバーを管理 */}
                    {isOwner && member.role !== "owner" && (
                      <div className="flex items-center gap-1">
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.user_id, e.target.value as "admin" | "member")}
                          className="text-[10px] bg-transparent border border-white/10 rounded px-1 py-0.5 text-gray-400"
                        >
                          <option value="member">メンバー</option>
                          <option value="admin">管理者</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          className="text-[10px] text-red-400 hover:text-red-300 ml-1"
                        >
                          削除
                        </button>
                      </div>
                    )}
                    {/* 自分自身の脱退（オーナー以外） */}
                    {!isOwner && member.user_id === user.id && (
                      <button
                        onClick={() => {
                          handleRemoveMember(user.id);
                          setSelectedTeam(null);
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        脱退
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* 試合履歴タブ */}
          {detailTab === "history" && (
            <TeamHistoryTab
              broadcasts={teamBroadcasts}
              loading={loadingHistory}
              teamName={selectedTeam.name}
            />
          )}

          {/* 設定タブ（オーナーのみ） */}
          {detailTab === "settings" && isOwner && (
            <div className="space-y-4 md:max-w-xl">
              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">チーム名</label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">スポーツ</label>
                    <select
                      value={editForm.sport}
                      onChange={(e) => setEditForm({ ...editForm, sport: e.target.value })}
                      className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm"
                    >
                      {Object.keys(SPORT_EMOJI).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value="その他">その他</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">説明（任意）</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={2}
                      className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleUpdate}
                      disabled={submitting}
                      className="flex-1 bg-[#e63946] text-white text-xs py-2 rounded-md hover:bg-[#e63946]/90 disabled:opacity-50"
                    >
                      {submitting ? "保存中..." : "保存"}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-4 text-xs text-gray-400 border border-white/10 rounded-md hover:bg-white/5"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setEditForm({
                        name: selectedTeam.name,
                        sport: selectedTeam.sport,
                        description: selectedTeam.description || "",
                      });
                      setEditing(true);
                    }}
                    className="w-full text-left rounded-md bg-[#111] border border-white/5 px-4 py-3 text-xs text-gray-300 hover:bg-white/5 transition"
                  >
                    チーム情報を編集
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("本当にこのチームを削除しますか？\nメンバー全員がチームから外れます。")) {
                        handleDelete();
                      }
                    }}
                    className="w-full text-left rounded-md bg-[#111] border border-red-500/20 px-4 py-3 text-xs text-red-400 hover:bg-red-500/5 transition"
                  >
                    チームを削除
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // チーム一覧（メイン画面）
  const isTeamPlan = profile?.plan === "team";

  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <div className="flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold text-gray-400">チーム</h1>
            {isTeamPlan && (
              <button
                onClick={() => setTab(tab === "create" ? "list" : "create")}
                className="text-[10px] text-[#e63946] border border-[#e63946]/30 px-2.5 py-1 rounded-md hover:bg-[#e63946]/5"
              >
                {tab === "create" ? "戻る" : "+ 新規作成"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-5 pb-20">
        {/* タブ切り替え */}
        <div className="flex gap-1 mt-3 mb-4">
          {([
            { key: "list" as const, label: "マイチーム" },
            { key: "join" as const, label: "招待コードで参加" },
            ...(isTeamPlan ? [{ key: "create" as const, label: "新規作成" }] : []),
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-md transition ${
                tab === t.key
                  ? "bg-white/10 text-white"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* マイチーム一覧 */}
        {tab === "list" && (
          <div>
            {loadingTeams ? (
              <div className="text-center py-12">
                <p className="text-xs text-gray-500">読み込み中...</p>
              </div>
            ) : teams.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-400">まだチームがありません</p>
                <p className="mt-1 text-[10px] text-gray-600 leading-relaxed">
                  招待コードで参加するか、
                  <br />
                  チームプランで新規作成できます
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    onClick={() => setTab("join")}
                    className="text-xs text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/15 transition"
                  >
                    招待コードで参加
                  </button>
                  {!isTeamPlan && (
                    <Link
                      href="/pricing"
                      className="text-xs text-[#e63946] border border-[#e63946]/30 px-4 py-2 rounded-md hover:bg-[#e63946]/5 transition text-center"
                    >
                      チームプランでチームを作成
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-3 lg:grid-cols-3">
                {teams.map((team) => {
                  const myRole = team.team_members.find((m) => m.user_id === user.id)?.role;
                  return (
                    <button
                      key={team.id}
                      onClick={() => {
                        setSelectedTeam(team);
                        setDetailTab("members");
                      }}
                      className="w-full text-left rounded-md bg-[#111] border border-white/5 px-4 py-3 hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#e63946]/10 flex items-center justify-center">
                          <span className="text-base">{getSportEmoji(team.sport)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{team.name}</p>
                          <p className="text-[10px] text-gray-500">
                            {team.sport} / {team.team_members.length}人 / {ROLE_LABELS[myRole || "member"]}
                          </p>
                        </div>
                        <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 招待コードで参加 */}
        {tab === "join" && (
          <div className="mt-2 md:max-w-xl">
            <p className="text-xs text-gray-400 mb-3">
              チームの管理者から共有された招待コードを入力してください
            </p>
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="例: ABCD1234"
                maxLength={8}
                className="flex-1 bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm font-mono tracking-wider placeholder:text-gray-700 uppercase"
              />
              <button
                onClick={handleJoin}
                disabled={submitting || !joinCode.trim()}
                className="bg-[#e63946] text-white text-xs px-4 rounded-md hover:bg-[#e63946]/90 disabled:opacity-50"
              >
                {submitting ? "..." : "参加"}
              </button>
            </div>
          </div>
        )}

        {/* チーム作成フォーム */}
        {tab === "create" && isTeamPlan && (
          <div className="mt-2 space-y-3 md:max-w-xl">
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">チーム名 *</label>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="例: 港FC"
                className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm placeholder:text-gray-700"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">スポーツ *</label>
              <select
                value={createForm.sport}
                onChange={(e) => setCreateForm({ ...createForm, sport: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm"
              >
                {Object.keys(SPORT_EMOJI).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="その他">その他</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">説明（任意）</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="例: 港区の小学生サッカーチームです"
                rows={2}
                className="w-full bg-[#111] border border-white/10 rounded-md px-3 py-2.5 text-sm resize-none placeholder:text-gray-700"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={submitting || !createForm.name.trim()}
              className="w-full bg-[#e63946] text-white text-sm py-2.5 rounded-md hover:bg-[#e63946]/90 disabled:opacity-50 transition"
            >
              {submitting ? "作成中..." : "チームを作成"}
            </button>
          </div>
        )}

        {/* チームプラン未加入のCTA（作成タブが無い場合の補足） */}
        {tab === "list" && teams.length > 0 && !isTeamPlan && (
          <div className="mt-4 rounded-lg bg-[#111] border border-white/5 p-4 text-center">
            <p className="text-[11px] text-gray-400">
              チームプラン（¥500/月）で新しいチームを作成できます
            </p>
            <Link
              href="/pricing"
              className="inline-block mt-2 text-xs text-[#e63946] border border-[#e63946]/30 px-4 py-1.5 rounded-md hover:bg-[#e63946]/5 transition"
            >
              プランを見る
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 試合履歴タブ =====
function TeamHistoryTab({
  broadcasts,
  loading,
  teamName,
}: {
  broadcasts: Broadcast[];
  loading: boolean;
  teamName: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (broadcasts.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-14 h-14 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
          </svg>
        </div>
        <p className="text-sm font-bold text-gray-400">まだ試合履歴はありません</p>
        <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
          配信画面で「所属チーム」を選んで配信すると、<br />
          ここに試合履歴が記録されます。
        </p>
      </div>
    );
  }

  // 統計サマリ
  const ended = broadcasts.filter((b) => b.status === "ended");
  const totalHomeScore = ended.reduce((sum, b) => sum + (b.home_score || 0), 0);
  const totalAwayScore = ended.reduce((sum, b) => sum + (b.away_score || 0), 0);

  // 月別にグループ化
  const grouped: { month: string; items: Broadcast[] }[] = [];
  for (const bc of broadcasts) {
    const d = new Date(bc.started_at);
    const month = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    const last = grouped[grouped.length - 1];
    if (last && last.month === month) {
      last.items.push(bc);
    } else {
      grouped.push({ month, items: [bc] });
    }
  }

  return (
    <div>
      {/* サマリカード */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="rounded-md bg-[#111] border border-white/5 px-3 py-2.5 text-center">
          <p className="text-[10px] text-gray-500">試合数</p>
          <p className="text-base font-bold text-white">{broadcasts.length}</p>
        </div>
        <div className="rounded-md bg-[#111] border border-white/5 px-3 py-2.5 text-center">
          <p className="text-[10px] text-gray-500">総得点</p>
          <p className="text-base font-bold text-[#e63946]">{totalHomeScore}</p>
        </div>
        <div className="rounded-md bg-[#111] border border-white/5 px-3 py-2.5 text-center">
          <p className="text-[10px] text-gray-500">総失点</p>
          <p className="text-base font-bold text-gray-400">{totalAwayScore}</p>
        </div>
      </div>

      {/* 月別グループ */}
      <div className="space-y-5">
        {grouped.map((group) => (
          <div key={group.month}>
            <h3 className="text-[11px] font-semibold text-gray-500 mb-2">{group.month}</h3>
            <div className="space-y-2">
              {group.items.map((bc) => {
                const d = new Date(bc.started_at);
                const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
                const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
                const wd = weekdays[d.getDay()];
                const isLive = bc.status === "live";
                const isOurHome = bc.home_team === teamName;
                const ourScore = isOurHome ? bc.home_score : bc.away_score;
                const oppScore = isOurHome ? bc.away_score : bc.home_score;
                const oppName = isOurHome ? bc.away_team : bc.home_team;
                const won = !isLive && ourScore > oppScore;
                const lost = !isLive && ourScore < oppScore;

                return (
                  <Link
                    key={bc.id}
                    href={`/watch/${bc.share_code}`}
                    className="block rounded-md bg-[#111] border border-white/5 hover:border-white/10 transition px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 text-[10px] text-gray-500">
                        <span>{dateStr}（{wd}）</span>
                        {bc.tournament && (
                          <span className="truncate">{bc.tournament}</span>
                        )}
                      </div>
                      {isLive ? (
                        <span className="bg-[#e63946] text-white text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider">
                          LIVE
                        </span>
                      ) : won ? (
                        <span className="text-[9px] font-bold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">勝</span>
                      ) : lost ? (
                        <span className="text-[9px] font-bold text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">負</span>
                      ) : (
                        <span className="text-[9px] font-bold text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">分</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold truncate flex-1">
                        vs {oppName}
                      </p>
                      <p className="text-sm font-bold whitespace-nowrap">
                        <span className={won ? "text-[#e63946]" : "text-white"}>{ourScore}</span>
                        <span className="text-gray-500 mx-1.5">-</span>
                        <span className="text-gray-400">{oppScore}</span>
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
