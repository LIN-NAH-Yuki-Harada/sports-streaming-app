"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AuthForm } from "@/components/auth-form";
import { useToast } from "@/components/toaster";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase";
import {
  getBroadcastHistory,
  listMyUpcomingSchedules,
  type Broadcast,
  type TeamSchedule,
} from "@/lib/database";

const SPORT_EMOJI: Record<string, string> = {
  サッカー: "⚽",
  野球: "⚾",
  バスケ: "🏀",
  バレー: "🏐",
  陸上: "🏃",
  その他: "🏆",
};

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];

type TeamMember = { user_id: string; role: "owner" | "admin" | "member" };
type Team = {
  id: string;
  name: string;
  sport: string;
  owner_id: string;
  team_members: TeamMember[];
};

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SchedulePageInner />
    </Suspense>
  );
}

function SchedulePageInner() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");

  return (
    <div>
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <h1 className="text-sm font-bold text-gray-400">スケジュール</h1>
        </div>

        {/* タブ */}
        <div className="mt-3 flex gap-1">
          {(["upcoming", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-md transition ${
                tab === t
                  ? "bg-white/10 text-white"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {t === "upcoming" ? "予定" : "履歴"}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 md:px-8 lg:px-10 pb-20">
        {tab === "upcoming" ? (
          authLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : user ? (
            <UpcomingTab userId={user.id} />
          ) : (
            <LoginPrompt />
          )
        ) : (
          <HistoryTab />
        )}
      </div>
    </div>
  );
}

// ===== 未ログイン =====
function LoginPrompt() {
  return (
    <div className="pt-8 text-center">
      <p className="text-sm text-gray-400">予定を見るにはログインが必要です</p>
      <div className="mt-6 max-w-sm mx-auto">
        <AuthForm />
      </div>
    </div>
  );
}

// ===== 予定タブ =====
function UpcomingTab({ userId }: { userId: string }) {
  const toast = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [schedules, setSchedules] = useState<TeamSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeamSchedule | null>(null);

  const getToken = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (token) {
        const res = await fetch("/api/teams", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setTeams(data.teams || []);
      }
      const list = await listMyUpcomingSchedules();
      setSchedules(list);
    } catch {
      toast.error("予定の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [getToken, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 自分がオーナー or 管理者のチーム
  const adminTeams = useMemo(() => {
    return teams.filter((t) => {
      const m = t.team_members.find((m) => m.user_id === userId);
      return m?.role === "owner" || m?.role === "admin";
    });
  }, [teams, userId]);

  const adminTeamIds = useMemo(
    () => new Set(adminTeams.map((t) => t.id)),
    [adminTeams]
  );

  const teamNameMap = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => m.set(t.id, t.name));
    return m;
  }, [teams]);

  // 月別にグルーピング
  const grouped = useMemo(() => {
    const result: { label: string; items: TeamSchedule[] }[] = [];
    for (const sc of schedules) {
      const d = new Date(sc.start_at);
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      const last = result[result.length - 1];
      if (last && last.label === label) {
        last.items.push(sc);
      } else {
        result.push({ label, items: [sc] });
      }
    }
    return result;
  }, [schedules]);

  const handleDelete = async (id: string) => {
    if (!confirm("この予定を削除しますか？")) return;
    const token = await getToken();
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "削除に失敗しました");
        return;
      }
      toast.success("予定を削除しました");
      refresh();
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  return (
    <div className="pt-4">
      {/* 予定追加ボタン */}
      {adminTeams.length > 0 && !formOpen && !editing && (
        <button
          onClick={() => setFormOpen(true)}
          className="mb-4 w-full md:max-w-sm bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 rounded-md transition"
        >
          + 予定を追加
        </button>
      )}

      {/* 作成フォーム */}
      {formOpen && !editing && (
        <ScheduleForm
          mode="create"
          teams={adminTeams}
          onSaved={() => {
            setFormOpen(false);
            refresh();
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {/* 編集フォーム */}
      {editing && (
        <ScheduleForm
          mode="edit"
          teams={adminTeams}
          initial={editing}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* ロード中 */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 予定なし */}
      {!loading && schedules.length === 0 && !formOpen && !editing && (
        <EmptyState hasAdminTeam={adminTeams.length > 0} hasAnyTeam={teams.length > 0} />
      )}

      {/* 予定リスト */}
      {!loading && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.label}>
              <h2 className="text-xs text-gray-500 font-medium mb-2">{group.label}</h2>
              <div className="space-y-2">
                {group.items.map((sc) => (
                  <ScheduleItem
                    key={sc.id}
                    schedule={sc}
                    teamName={teamNameMap.get(sc.team_id) || ""}
                    canEdit={adminTeamIds.has(sc.team_id)}
                    onEdit={() => setEditing(sc)}
                    onDelete={() => handleDelete(sc.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  hasAdminTeam,
  hasAnyTeam,
}: {
  hasAdminTeam: boolean;
  hasAnyTeam: boolean;
}) {
  return (
    <div className="text-center py-12">
      <div className="w-14 h-14 mx-auto rounded-full bg-white/5 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-gray-600"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
          />
        </svg>
      </div>
      {hasAdminTeam ? (
        <>
          <p className="text-sm font-bold text-gray-400">予定はまだありません</p>
          <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
            「+ 予定を追加」から、<br />
            次の試合や練習を登録できます。
          </p>
        </>
      ) : hasAnyTeam ? (
        <>
          <p className="text-sm font-bold text-gray-400">予定はまだありません</p>
          <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
            オーナー・管理者が予定を登録するとここに表示されます。
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-bold text-gray-400">チームに所属していません</p>
          <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
            スケジュール機能はチームに所属すると利用できます。
          </p>
          <Link
            href="/search"
            className="inline-block mt-4 text-xs text-[#e63946] hover:underline"
          >
            チームを探す・作る
          </Link>
        </>
      )}
    </div>
  );
}

// ===== 予定フォーム =====
function ScheduleForm({
  mode,
  teams,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  teams: Team[];
  initial?: TeamSchedule;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [teamId, setTeamId] = useState(initial?.team_id || teams[0]?.id || "");
  const [startAt, setStartAt] = useState(() => {
    if (initial) {
      const d = new Date(initial.start_at);
      const pad = (n: number) => n.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // デフォルトは明日の10:00
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [sport, setSport] = useState(initial?.sport || teams[0]?.sport || "サッカー");
  const [homeTeam, setHomeTeam] = useState(initial?.home_team || teams[0]?.name || "");
  const [awayTeam, setAwayTeam] = useState(initial?.away_team || "");
  const [location, setLocation] = useState(initial?.location || "");
  const [tournament, setTournament] = useState(initial?.tournament || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [saving, setSaving] = useState(false);

  // チーム変更時に sport / home_team を自動補完
  const handleTeamChange = (newTeamId: string) => {
    setTeamId(newTeamId);
    const team = teams.find((t) => t.id === newTeamId);
    if (team) {
      setHomeTeam(team.name);
      const match = SPORTS.find((s) => team.sport.includes(s));
      if (match) setSport(match);
    }
  };

  const canSubmit =
    teamId && startAt && sport && homeTeam.trim() && awayTeam.trim() && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        toast.error("ログインが必要です");
        return;
      }

      const url = mode === "create" ? "/api/schedules" : `/api/schedules/${initial!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const body = {
        teamId,
        startAt: new Date(startAt).toISOString(),
        sport,
        homeTeam: homeTeam.trim(),
        awayTeam: awayTeam.trim(),
        location: location.trim() || null,
        tournament: tournament.trim() || null,
        notes: notes.trim() || null,
      };

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "保存に失敗しました");
        return;
      }
      toast.success(mode === "create" ? "予定を追加しました" : "予定を更新しました");
      onSaved();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // min は 1 時間前まで許容
  const minDateTime = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <div className="mb-6 rounded-lg bg-[#111] border border-white/10 p-4 space-y-3 md:max-w-2xl">
      <h3 className="text-sm font-bold">{mode === "create" ? "予定を追加" : "予定を編集"}</h3>

      <div>
        <label className="text-[10px] text-gray-500 block mb-1">チーム</label>
        <select
          value={teamId}
          onChange={(e) => handleTeamChange(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}（{t.sport}）
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[10px] text-gray-500 block mb-1">開始日時</label>
        <input
          type="datetime-local"
          value={startAt}
          min={minDateTime}
          onChange={(e) => setStartAt(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="text-[10px] text-gray-500 block mb-1">種目</label>
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
        >
          {SPORTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">ホーム（自チーム）</label>
          <input
            value={homeTeam}
            onChange={(e) => setHomeTeam(e.target.value)}
            placeholder="自チーム名"
            maxLength={50}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">アウェイ（対戦相手）</label>
          <input
            value={awayTeam}
            onChange={(e) => setAwayTeam(e.target.value)}
            placeholder="相手チーム名"
            maxLength={50}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-gray-500 block mb-1">場所（任意）</label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 〇〇市民体育館"
          maxLength={100}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="text-[10px] text-gray-500 block mb-1">大会名（任意）</label>
        <input
          value={tournament}
          onChange={(e) => setTournament(e.target.value)}
          placeholder="例: 〇〇市春季大会"
          maxLength={100}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="text-[10px] text-gray-500 block mb-1">メモ（任意）</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={300}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-md px-3 py-2 text-sm resize-none"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex-1 bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 rounded-md transition disabled:opacity-50"
        >
          {saving ? "保存中..." : mode === "create" ? "追加する" : "更新する"}
        </button>
        <button
          onClick={onCancel}
          className="px-5 text-xs text-gray-400 border border-white/10 rounded-md hover:bg-white/5"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ===== 予定アイテム =====
function ScheduleItem({
  schedule,
  teamName,
  canEdit,
  onEdit,
  onDelete,
}: {
  schedule: TeamSchedule;
  teamName: string;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const d = new Date(schedule.start_at);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLabel = `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
  const timeLabel = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

  // 配信開始URL
  const params = new URLSearchParams({
    sport: schedule.sport,
    home: schedule.home_team,
    away: schedule.away_team,
    teamId: schedule.team_id,
  });
  if (schedule.tournament) params.set("tournament", schedule.tournament);
  if (schedule.location) params.set("venue", schedule.location);
  const broadcastUrl = `/broadcast?${params.toString()}`;

  return (
    <div className="rounded-lg bg-[#111] border border-white/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span className="text-[#e63946] font-semibold">{dateLabel}</span>
          <span>{timeLabel}</span>
          {teamName && <span className="truncate">{teamName}</span>}
        </div>
        <span className="text-sm">{SPORT_EMOJI[schedule.sport] || "🏆"}</span>
      </div>

      <p className="text-sm font-semibold">
        {schedule.home_team} <span className="text-gray-500 text-xs mx-1">vs</span> {schedule.away_team}
      </p>

      {(schedule.tournament || schedule.location) && (
        <div className="mt-1 text-[11px] text-gray-500 space-y-0.5">
          {schedule.tournament && <p>🏆 {schedule.tournament}</p>}
          {schedule.location && <p>📍 {schedule.location}</p>}
        </div>
      )}

      {schedule.notes && (
        <p className="mt-2 text-[11px] text-gray-400 whitespace-pre-wrap">{schedule.notes}</p>
      )}

      {canEdit && (
        <div className="mt-3 flex gap-2">
          <a
            href={broadcastUrl}
            className="flex-1 bg-[#e63946] hover:bg-[#d62836] text-white text-[11px] font-semibold py-2 rounded-md text-center transition"
          >
            ▶ 配信開始
          </a>
          <button
            onClick={onEdit}
            className="px-3 text-[11px] text-gray-400 border border-white/10 rounded-md hover:bg-white/5"
          >
            編集
          </button>
          <button
            onClick={onDelete}
            className="px-3 text-[11px] text-red-400 border border-red-400/20 rounded-md hover:bg-red-400/5"
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}

// ===== 履歴タブ =====
function HistoryTab() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBroadcastHistory().then((data) => {
      setBroadcasts(data);
      setLoading(false);
    });
  }, []);

  const grouped: { date: string; items: Broadcast[] }[] = [];
  for (const bc of broadcasts) {
    const d = new Date(bc.started_at);
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const date = `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
    const last = grouped[grouped.length - 1];
    if (last && last.date === date) {
      last.items.push(bc);
    } else {
      grouped.push({ date, items: [bc] });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (broadcasts.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-gray-500">まだ配信履歴がありません</p>
        <p className="text-xs text-gray-600 mt-1">配信を行うとここに履歴が表示されます</p>
        <a href="/broadcast" className="inline-block mt-4 text-xs text-[#e63946] hover:underline">
          配信をはじめる
        </a>
      </div>
    );
  }

  return (
    <>
      {grouped.map((group) => (
        <div key={group.date} className="mt-6 first:mt-4">
          <h2 className="text-xs text-gray-500 font-medium mb-2">{group.date}</h2>
          <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-3 lg:grid-cols-3">
            {group.items.map((bc) => {
              const d = new Date(bc.started_at);
              const timeLabel = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
              return (
                <div
                  key={bc.id}
                  className="rounded-lg bg-[#111] border border-white/5 px-4 py-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{SPORT_EMOJI[bc.sport] || "🏆"}</span>
                        <p className="text-sm font-medium truncate">
                          {bc.home_team} vs {bc.away_team}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {bc.tournament && (
                          <span className="text-xs text-gray-500">{bc.tournament}</span>
                        )}
                        <span className="text-xs text-gray-600">{timeLabel}</span>
                      </div>
                    </div>
                    <div className="shrink-0 ml-3 text-right">
                      {(bc.home_sets > 0 || bc.away_sets > 0) ? (
                        <>
                          <div className="flex items-center gap-1.5 bg-black/30 rounded px-2.5 py-1.5">
                            <span className="text-base font-black tabular-nums text-yellow-400">{bc.home_sets}</span>
                            <span className="text-xs text-gray-600">-</span>
                            <span className="text-base font-black tabular-nums text-yellow-400">{bc.away_sets}</span>
                          </div>
                          {bc.set_results && bc.set_results.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {bc.set_results.map((set: { home: number; away: number }, i: number) => (
                                <p key={i} className="text-[10px] text-gray-500 tabular-nums">
                                  S{i + 1}: {set.home}-{set.away}
                                </p>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5 bg-black/30 rounded px-2.5 py-1.5">
                          <span className="text-base font-black tabular-nums">{bc.home_score}</span>
                          <span className="text-xs text-gray-600">-</span>
                          <span className="text-base font-black tabular-nums">{bc.away_score}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
