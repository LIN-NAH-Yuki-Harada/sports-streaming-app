import { getUser, getAdminClient } from "@/lib/supabase-admin";

// GET /api/teams — 自分の所属チーム一覧
export async function GET(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = getAdminClient();

    // 自分が所属するチームのID
    const { data: memberships } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id);

    if (!memberships?.length) {
      return Response.json({ teams: [] });
    }

    const teamIds = memberships.map((m) => m.team_id);

    const { data: teams, error } = await supabase
      .from("teams")
      .select("*, team_members(id, user_id, role, joined_at, profiles(id, display_name, avatar_url))")
      .in("id", teamIds)
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ teams: teams || [] });
  } catch (e) {
    console.error("GET /api/teams error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/teams — チーム作成（チームプラン限定）
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = getAdminClient();

    // プランチェック
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    if (profile?.plan !== "team") {
      return Response.json(
        { error: "チームプラン（¥500/月）への加入が必要です" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, sport, description } = body;

    if (!name || !sport) {
      return Response.json({ error: "チーム名とスポーツは必須です" }, { status: 400 });
    }

    // 招待コード生成
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let inviteCode = "";
    for (let i = 0; i < 8; i++) inviteCode += chars[Math.floor(Math.random() * chars.length)];

    // チーム作成
    const { data: team, error } = await supabase
      .from("teams")
      .insert({
        name,
        sport,
        description: description || null,
        invite_code: inviteCode,
        owner_id: user.id,
      })
      .select()
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    // オーナーをメンバーに追加
    await supabase.from("team_members").insert({
      team_id: team.id,
      user_id: user.id,
      role: "owner",
    });

    return Response.json({ team }, { status: 201 });
  } catch (e) {
    console.error("POST /api/teams error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
