import { requireAdmin } from "@/lib/admin-auth";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// LIVE配信の強制終了（管理者のみ）。ゴースト（異常終了で status=live のまま残った配信）を
// 掃除する。status/live_status を ended にし、ended_at を打つ。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.action !== "end") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("broadcasts")
    .update({ status: "ended", ended_at: nowIso, live_status: "ended" })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
