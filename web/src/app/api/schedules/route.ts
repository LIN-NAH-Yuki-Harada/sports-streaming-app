import { getUser, getAdminClient } from "@/lib/supabase-admin";

// POST /api/schedules — 予定作成（チーム所属 + 配信可能プラン）
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

    // チーム所属チェック（ロール不問）
    const { data: membership } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return Response.json(
        { error: "このチームのメンバーではありません" },
        { status: 403 },
      );
    }

    // 配信可能な有料プラン (broadcaster / team) チェック
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.plan !== "broadcaster" && profile?.plan !== "team") {
      return Response.json(
        { error: "予定の作成には配信可能なプラン（¥300以上）が必要です" },
        { status: 403 },
      );
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
