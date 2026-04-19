import { getUser, getAdminClient } from "@/lib/supabase-admin";

// POST /api/schedules — 予定作成（オーナー・管理者のみ）
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { teamId, startAt, sport, homeTeam, awayTeam, location, tournament, notes } = body;

    if (!teamId || !startAt || !sport || !homeTeam || !awayTeam) {
      return Response.json(
        { error: "チーム・日時・種目・対戦相手は必須です" },
        { status: 400 }
      );
    }

    // 過去1時間より前はNG
    const startDate = new Date(startAt);
    if (isNaN(startDate.getTime())) {
      return Response.json({ error: "日時の形式が不正です" }, { status: 400 });
    }
    if (startDate.getTime() < Date.now() - 60 * 60 * 1000) {
      return Response.json({ error: "過去の日時は指定できません" }, { status: 400 });
    }

    const supabase = getAdminClient();

    // オーナー・管理者チェック
    const { data: membership } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return Response.json({ error: "権限がありません" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("team_schedules")
      .insert({
        team_id: teamId,
        start_at: startDate.toISOString(),
        sport,
        home_team: homeTeam,
        away_team: awayTeam,
        location: location || null,
        tournament: tournament || null,
        notes: notes || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ schedule: data }, { status: 201 });
  } catch (e) {
    console.error("POST /api/schedules error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
