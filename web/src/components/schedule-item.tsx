"use client";

import type { TeamSchedule } from "@/lib/database";

const SPORT_EMOJI: Record<string, string> = {
  サッカー: "⚽",
  野球: "⚾",
  バスケ: "🏀",
  バレー: "🏐",
  陸上: "🏃",
  その他: "🏆",
};

export function ScheduleItem({
  schedule,
  teamName,
  canEdit,
  onEdit,
  onDelete,
}: {
  schedule: TeamSchedule;
  teamName: string;
  canEdit: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const d = new Date(schedule.start_at);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLabel = `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
  const timeLabel = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

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
          {onEdit && (
            <button
              onClick={onEdit}
              className="px-3 text-[11px] text-gray-400 border border-white/10 rounded-md hover:bg-white/5"
            >
              編集
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="px-3 text-[11px] text-red-400 border border-red-400/20 rounded-md hover:bg-red-400/5"
            >
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}
