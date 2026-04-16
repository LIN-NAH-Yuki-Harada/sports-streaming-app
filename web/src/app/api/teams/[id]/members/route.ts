import { getUser, getAdminClient } from "@/lib/supabase-admin";

// DELETE /api/teams/[id]/members — メンバー削除（オーナー/管理者、または自己脱退）
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id: teamId } = await params;
    const body = await request.json().catch(() => ({}));
    const targetUserId = body.userId || user.id;

    const supabase = getAdminClient();

    // 自分自身の脱退でない場合、オーナー/管理者権限が必要
    if (targetUserId !== user.id) {
      const { data: myMembership } = await supabase
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", user.id)
        .single();

      if (!myMembership || !["owner", "admin"].includes(myMembership.role)) {
        return Response.json({ error: "権限がありません" }, { status: 403 });
      }
    }

    // オーナーは脱退不可（チーム削除を使う）
    const { data: targetMember } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", targetUserId)
      .single();

    if (targetMember?.role === "owner") {
      return Response.json(
        { error: "オーナーは脱退できません。チームを削除してください。" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", targetUserId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/teams/[id]/members error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/teams/[id]/members — メンバーロール変更（オーナーのみ）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id: teamId } = await params;
    const body = await request.json().catch(() => ({}));
    const { userId: targetUserId, role } = body;

    if (!targetUserId || !["admin", "member"].includes(role)) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = getAdminClient();

    // オーナー確認
    const { data: myMembership } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .single();

    if (myMembership?.role !== "owner") {
      return Response.json({ error: "オーナーのみロール変更可能です" }, { status: 403 });
    }

    const { error } = await supabase
      .from("team_members")
      .update({ role })
      .eq("team_id", teamId)
      .eq("user_id", targetUserId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("PUT /api/teams/[id]/members error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
