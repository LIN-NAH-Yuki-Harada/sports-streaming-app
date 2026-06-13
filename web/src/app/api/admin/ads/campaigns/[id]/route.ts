import { requireAdmin } from "@/lib/admin-auth";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// キャンペーンの有効/無効トグル等（管理者のみ）。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  let body: { active?: boolean; weight?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.weight === "number")
    patch.weight = Math.min(100, Math.max(1, Math.round(body.weight)));
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin.from("ad_campaigns").update(patch).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// キャンペーン削除（管理者のみ）。クリエイティブは ON DELETE CASCADE で連動削除。
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const admin = getAdminClient();
  const { error } = await admin.from("ad_campaigns").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
