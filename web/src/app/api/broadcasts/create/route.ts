import { getUser } from "@/lib/supabase-admin";

// 注: このエンドポイントは旧実装で profiles.trial_used を立てていた。
// 2026-04-22 に累積方式（trial_seconds_used）に変更したため、
// トライアル記録は /api/broadcasts/trial-consume へ移行。
// 本エンドポイントは旧キャッシュを持つクライアントとの互換目的で no-op 化して残している。
// 後日（新バンドル浸透確認後）に削除予定。
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ success: true, deprecated: true });
  } catch (e) {
    console.error("broadcasts/create (deprecated) error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
