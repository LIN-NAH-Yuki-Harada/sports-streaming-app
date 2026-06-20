import { getAdminClient } from "@/lib/supabase-admin";
import { sendPlanPitchEmail } from "@/lib/emails/plan-pitch";

/**
 * 新規登録ウェルカムメール（Netflix型の変換funnel・登録時の認知）。
 *
 * Supabase の Database Webhook（profiles テーブルの INSERT）から呼ばれる想定。
 * 新規ユーザー（Web/アプリ どちらの登録でも on_auth_user_created で profiles 行が作られる）
 * に対して、3プラン（無料/配信者¥300/チーム¥500）と /pricing への導線をメールで案内する。
 *
 * ※ もう一つの送信タイミング（無料10分を使い切った瞬間）は
 *    /api/broadcasts/trial-consume 側で context="trial_end" として送る。
 */

// Supabase Webhook が送る秘密ヘッダ（x-webhook-secret）と一致するか検証する。
const WEBHOOK_SECRET = process.env.WELCOME_WEBHOOK_SECRET;

export async function POST(request: Request) {
  try {
    // 1) 認証: Supabase Webhook が送る秘密ヘッダを検証（設定時のみ）。
    if (WEBHOOK_SECRET) {
      const got = request.headers.get("x-webhook-secret");
      if (got !== WEBHOOK_SECRET) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    // 2) Supabase Database Webhook のペイロード: { type, table, record: {...} }
    const body = await request.json().catch(() => null);
    const record = body?.record ?? body;
    const userId: string | undefined = record?.id;
    const plan: string | undefined = record?.plan;

    if (!userId) {
      return Response.json({ error: "no user id" }, { status: 400 });
    }
    // 新規無料ユーザーだけを対象（万一 plan が free 以外で作られた行には送らない）。
    if (plan && plan !== "free") {
      return Response.json({ success: true, skipped: "non-free" });
    }

    // 3) メールアドレスを取得（Service Role）。
    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (error || !email) {
      console.warn("[welcome] email not found for", userId, error?.message);
      // 200 を返して Webhook の再試行（=二重送信）を防ぐ。
      return Response.json({ success: true, skipped: "no-email" });
    }

    // 4) 送信（失敗は握りつぶす）。
    await sendPlanPitchEmail({ email, context: "welcome" });
    return Response.json({ success: true });
  } catch (e) {
    console.error("[welcome] error:", e);
    // welcome メールは非クリティカル。例外時も 200（再試行による二重送信を避ける）。
    return Response.json({ success: true, error: "handled" });
  }
}
