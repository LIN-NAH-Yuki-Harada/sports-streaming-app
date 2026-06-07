import { getUser } from "@/lib/supabase-admin";
import { terminateStaleBroadcasts } from "@/lib/terminate-stale-broadcasts";

// livekit-server-sdk の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * 新規配信を開始する直前に叩く「古い配信の強制終了」API。
 *
 * 同じ broadcaster の生きている配信（前回が異常終了して裏に残ったゴースト
 * 含む）を全部終了し、1 台の端末が映像を 2 本同時にエンコードして発熱・
 * シャットダウンする事故を防ぐ。
 *
 * best-effort: 失敗してもクライアントの新規配信開始は妨げない想定のため、
 * 認証エラー以外は 200 で返す。
 */
export async function POST(request: Request) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const terminated = await terminateStaleBroadcasts(user.id);
    return Response.json({ terminated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    console.error("[cleanup-stale]", message);
    // best-effort: エラーでも 200 で返し、新規配信開始をブロックしない
    return Response.json({ terminated: 0, error: message });
  }
}
