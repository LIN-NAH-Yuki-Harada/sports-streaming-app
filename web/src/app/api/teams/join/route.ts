import { getUser, getAdminClient } from "@/lib/supabase-admin";

// POST /api/teams/join — 招待コードでチーム参加
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const inviteCode = (body.inviteCode as string)?.trim().toUpperCase();

    if (!inviteCode) {
      return Response.json({ error: "招待コードを入力してください" }, { status: 400 });
    }

    const supabase = getAdminClient();

    // 招待コードでチーム検索
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("*")
      .eq("invite_code", inviteCode)
      .single();

    if (teamError || !team) {
      return Response.json({ error: "招待コードが見つかりません" }, { status: 404 });
    }

    // 既にメンバーか確認
    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", team.id)
      .eq("user_id", user.id)
      .single();

    if (existing) {
      return Response.json({ team, alreadyMember: true });
    }

    // メンバー追加
    const { error: joinError } = await supabase
      .from("team_members")
      .insert({
        team_id: team.id,
        user_id: user.id,
        role: "member",
      });

    if (joinError) {
      return Response.json({ error: joinError.message }, { status: 500 });
    }

    return Response.json({ team, alreadyMember: false }, { status: 201 });
  } catch (e) {
    console.error("POST /api/teams/join error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
