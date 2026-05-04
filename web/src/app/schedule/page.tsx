"use client";

import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import {
  getBroadcastHistory,
  getMyTeams,
  getTeamBroadcastHistory,
  type Broadcast,
  type TeamWithMembers,
} from "@/lib/database";

const SPORT_EMOJI: Record<string, string> = {
  サッカー: "⚽",
  野球: "⚾",
  バスケ: "🏀",
  バレー: "🏐",
  陸上: "🏃",
  その他: "🏆",
};

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SchedulePageInner />
    </Suspense>
  );
}

function SchedulePageInner() {
  return (
    <div>
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <h1 className="text-sm font-bold text-gray-400">配信履歴</h1>
        </div>
      </div>

      <div className="px-5 md:px-8 lg:px-10 pt-4 pb-20">
        <HistoryTab />
      </div>
    </div>
  );
}

// ===== 履歴タブ =====
// "self" = 自分の配信のみ / それ以外 = teamId（自分の所属チーム）
type HistoryFilter = "self" | string;

function HistoryTab() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<HistoryFilter>("self");
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [myTeams, setMyTeams] = useState<TeamWithMembers[]>([]);

  // 自分の所属チームを取得（初回のみ）
  useEffect(() => {
    if (!user) return;
    getMyTeams(user.id).then(setMyTeams);
  }, [user]);

  // フィルタ切替で履歴を取得し直す
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetcher =
      filter === "self"
        ? getBroadcastHistory()
        : getTeamBroadcastHistory(filter).then((data) =>
            // チーム配信履歴はライブも含むので、履歴タブでは終了済みに絞る
            data.filter((bc) => bc.status === "ended"),
          );
    fetcher.then((data) => {
      if (cancelled) return;
      setBroadcasts(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filter]);

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

  // 所属チームがあるときだけフィルタタブを表示（個人ユーザーには無関係）
  const filterTabs = myTeams.length > 0 && (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
      <button
        onClick={() => setFilter("self")}
        className={
          filter === "self"
            ? "shrink-0 bg-[#e63946] text-white text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition"
            : "shrink-0 bg-white/5 hover:bg-white/10 text-gray-400 text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition"
        }
      >
        自分の配信
      </button>
      {myTeams.map((team) => (
        <button
          key={team.id}
          onClick={() => setFilter(team.id)}
          className={
            filter === team.id
              ? "shrink-0 bg-[#e63946] text-white text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition"
              : "shrink-0 bg-white/5 hover:bg-white/10 text-gray-400 text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition"
          }
        >
          👥 {team.name}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <>
        {filterTabs}
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (broadcasts.length === 0) {
    const isTeamFilter = filter !== "self";
    return (
      <>
        {filterTabs}
        <div className="text-center py-16">
          <p className="text-sm text-gray-500">
            {isTeamFilter
              ? "このチームの配信履歴はまだありません"
              : "まだ配信履歴がありません"}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            {isTeamFilter
              ? "チームメンバーが配信するとここに表示されます"
              : "配信を行うとここに履歴が表示されます"}
          </p>
          {!isTeamFilter && (
            <a
              href="/broadcast"
              className="inline-block mt-4 text-xs text-[#e63946] hover:underline"
            >
              配信をはじめる
            </a>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {filterTabs}
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
                  {(bc.live_status || bc.youtube_upload_status) && (
                    <div className="mt-2.5 pt-2.5 border-t border-white/5">
                      {(() => {
                        // 新パイプライン (Live 中継) を優先判定。新旧は排他のため
                        // live_status が NULL のときのみ youtube_upload_status を見る。
                        if (bc.live_status === "live" || bc.live_status === "creating") {
                          return bc.live_youtube_broadcast_id ? (
                            <a
                              href={`https://youtu.be/${bc.live_youtube_broadcast_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] text-[#e63946] hover:underline font-medium"
                            >
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e63946] opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#e63946]" />
                              </span>
                              YouTube Live で配信中（限定公開）
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                              <span className="inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                              YouTube Live 準備中…
                            </span>
                          );
                        }
                        if (bc.live_status === "ended" && bc.live_youtube_broadcast_id) {
                          return (
                            <a
                              href={`https://youtu.be/${bc.live_youtube_broadcast_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] text-[#e63946] hover:underline font-medium"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                              </svg>
                              YouTube で見る（限定公開）
                            </a>
                          );
                        }
                        if (bc.live_status === "pending") {
                          return (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                              <span className="inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                              YouTube Live 準備中…
                            </span>
                          );
                        }
                        if (bc.live_status === "failed") {
                          return (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-yellow-500">
                              ⚠️ YouTube Live 配信失敗
                            </span>
                          );
                        }
                        // 旧パイプライン (録画 → cron アップロード)
                        if (bc.youtube_upload_status === "completed" && bc.youtube_video_id) {
                          return (
                            <a
                              href={`https://youtu.be/${bc.youtube_video_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] text-[#e63946] hover:underline font-medium"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                              </svg>
                              YouTube で見る（限定公開）
                            </a>
                          );
                        }
                        if (
                          bc.youtube_upload_status === "pending" ||
                          bc.youtube_upload_status === "recording" ||
                          bc.youtube_upload_status === "uploading"
                        ) {
                          return (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                              <span className="inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                              YouTube にアップロード中…
                            </span>
                          );
                        }
                        if (bc.youtube_upload_status === "cancelled") {
                          return <span className="text-[11px] text-gray-600">YouTube 保存なし</span>;
                        }
                        if (bc.youtube_upload_status === "failed") {
                          return (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-yellow-500">
                              ⚠️ アップロード失敗
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
