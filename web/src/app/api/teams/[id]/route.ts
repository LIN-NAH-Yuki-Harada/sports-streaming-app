import { getUser, getAdminClient } from "@/lib/supabase-admin";

// PUT /api/teams/[id] — チーム更新（オーナーのみ）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const supabase = getAdminClient();

    // オーナー確認
    const { data: team } = await supabase
      .from("teams")
      .select("owner_id")
      .eq("id", id)
      .single();

    if (!team || team.owner_id !== user.id) {
      return Response.json({ error: "権限がありません" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name) updates.name = body.name;
    if (body.sport) updates.sport = body.sport;
    if (body.description !== undefined) updates.description = body.description || null;

    const { data, error } = await supabase
      .from("teams")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ team: data });
  } catch (e) {
    console.error("PUT /api/teams/[id] error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/teams/[id] — チーム削除（オーナーのみ）
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const supabase = getAdminClient();

    const { data: team } = await supabase
      .from("teams")
      .select("owner_id")
      .eq("id", id)
      .single();

    if (!team || team.owner_id !== user.id) {
      return Response.json({ error: "権限がありません" }, { status: 403 });
    }

    const { error } = await supabase.from("teams").delete().eq("id", id);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/teams/[id] error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
