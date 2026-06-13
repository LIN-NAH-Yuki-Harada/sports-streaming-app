import { requireAdmin } from "@/lib/admin-auth";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ALLOWED = ["open", "reviewed", "actioned", "dismissed"];

// 通報のステータス更新（管理者のみ）。service_role で更新（reports は一般 UPDATE 不可）。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const status = body.status;
  if (!status || !ALLOWED.includes(status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin.from("reports").update({ status }).eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
