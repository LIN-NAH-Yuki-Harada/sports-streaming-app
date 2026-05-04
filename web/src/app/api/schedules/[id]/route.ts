import { getUser, getAdminClient } from "@/lib/supabase-admin";

async function checkScheduleAccess(
  supabase: ReturnType<typeof getAdminClient>,
  scheduleId: string,
  userId: string
) {
  const { data: schedule } = await supabase
    .from("team_schedules")
    .select("team_id")
    .eq("id", scheduleId)
    .single();

  if (!schedule) return { ok: false, status: 404, error: "予定が見つかりません" } as const;

  // チーム所属チェック（ロール不問）
  const { data: membership } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", schedule.team_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "このチームのメンバーではありません",
    } as const;
  }

  // 配信可能な有料プラン (broadcaster / team) チェック
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.plan !== "broadcaster" && profile?.plan !== "team") {
    return {
      ok: false,
      status: 403,
      error: "予定の編集には配信可能なプラン（¥300以上）が必要です",
    } as const;
  }

  return { ok: true, teamId: schedule.team_id } as const;
}

// PATCH /api/schedules/[id] — 予定更新（チーム所属 + 配信可能プラン）
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const supabase = getAdminClient();

    const access = await checkScheduleAccess(supabase, id, user.id);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.startAt) {
      const d = new Date(body.startAt);
      if (isNaN(d.getTime())) {
        return Response.json({ error: "日時の形式が不正です" }, { status: 400 });
      }
      updates.start_at = d.toISOString();
    }
    if (body.sport) updates.sport = body.sport;
    if (body.homeTeam) updates.home_team = body.homeTeam;
    if (body.awayTeam) updates.away_team = body.awayTeam;
    if (body.location !== undefined) updates.location = body.location || null;
    if (body.tournament !== undefined) updates.tournament = body.tournament || null;
    if (body.notes !== undefined) updates.notes = body.notes || null;

    const { data, error } = await supabase
      .from("team_schedules")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ schedule: data });
  } catch (e) {
    console.error("PATCH /api/schedules/[id] error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/schedules/[id] — 予定削除（チーム所属 + 配信可能プラン）
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const supabase = getAdminClient();

    const access = await checkScheduleAccess(supabase, id, user.id);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    const { error } = await supabase.from("team_schedules").delete().eq("id", id);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/schedules/[id] error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
