import { timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  // Vercel Cron の認証チェック（タイミング攻撃対策）
  const authHeader = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(authHeader);
  const authorized =
    !!process.env.CRON_SECRET &&
    expectedBuf.length === actualBuf.length &&
    timingSafeEqual(expectedBuf, actualBuf);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // 2時間以上経った live 配信を自動終了
  const { data, error } = await admin
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("status", "live")
    .lt("started_at", twoHoursAgo)
    .select("id");

  if (error) {
    console.error("Cron cleanup error:", error);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }

  return Response.json({ cleaned: data?.length || 0 });
}
