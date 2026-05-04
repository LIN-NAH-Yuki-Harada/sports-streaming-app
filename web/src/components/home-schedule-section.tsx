"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/toaster";
import { createClient } from "@/lib/supabase";
import { listMyUpcomingSchedules, type TeamSchedule } from "@/lib/database";
import { ScheduleForm, type ScheduleFormTeam } from "@/components/schedule-form";
import { ScheduleItem } from "@/components/schedule-item";

const HOME_LIMIT = 5;

export function HomeScheduleSection({
  initialSchedules,
  adminTeams,
  teamNameMap,
  adminTeamIds,
}: {
  initialSchedules: TeamSchedule[];
  adminTeams: ScheduleFormTeam[];
  teamNameMap: Record<string, string>;
  adminTeamIds: string[];
}) {
  const toast = useToast();
  const [schedules, setSchedules] = useState<TeamSchedule[]>(initialSchedules);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeamSchedule | null>(null);
  const adminSet = new Set(adminTeamIds);

  const refresh = useCallback(async () => {
    const list = await listMyUpcomingSchedules();
    setSchedules(list);
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("この予定を削除しますか？")) return;
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
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
      await refresh();
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  const visible = schedules.slice(0, HOME_LIMIT);
  const hasMore = schedules.length > HOME_LIMIT;
  const canCreate = adminTeams.length > 0;

  return (
    <section className="px-5 md:px-8 lg:px-10 pt-10">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-bold text-gray-300">次の予定</h2>
        {canCreate && !formOpen && !editing && (
          <button
            onClick={() => setFormOpen(true)}
            className="text-[11px] text-[#e63946] border border-[#e63946]/30 hover:bg-[#e63946]/5 px-3 py-1 rounded-md transition"
          >
            + 予定を追加
          </button>
        )}
      </div>

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

      {visible.length === 0 && !formOpen && !editing && (
        <div className="rounded-lg bg-[#111] border border-white/5 px-4 py-6 text-center">
          <p className="text-xs text-gray-500">
            {canCreate
              ? "予定はまだありません。「+ 予定を追加」から登録できます"
              : "登録された予定はまだありません"}
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <ScheduleItem
              key={s.id}
              schedule={s}
              teamName={teamNameMap[s.team_id] || ""}
              canEdit={adminSet.has(s.team_id)}
              onEdit={adminSet.has(s.team_id) ? () => setEditing(s) : undefined}
              onDelete={adminSet.has(s.team_id) ? () => handleDelete(s.id) : undefined}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <p className="mt-3 text-[10px] text-gray-600">
          ほかに {schedules.length - HOME_LIMIT} 件の予定があります（チーム詳細から確認できます）
        </p>
      )}
    </section>
  );
}
