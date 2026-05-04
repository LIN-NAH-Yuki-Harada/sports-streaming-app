"use client";

import { useState } from "react";
import { useToast } from "@/components/toaster";
import { createClient } from "@/lib/supabase";
import type { TeamSchedule } from "@/lib/database";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];

export type ScheduleFormTeam = {
  id: string;
  name: string;
  sport: string;
};

export function ScheduleForm({
  mode,
  teams,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  teams: ScheduleFormTeam[];
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

  const minDateTime = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const singleTeam = teams.length === 1;

  return (
    <div className="mb-6 rounded-lg bg-[#111] border border-white/10 p-4 space-y-3 md:max-w-2xl">
      <h3 className="text-sm font-bold">{mode === "create" ? "予定を追加" : "予定を編集"}</h3>

      {!singleTeam && (
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
      )}

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
