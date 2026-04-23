import { validatePromoCode } from "@/lib/promo";

/**
 * POST /api/promo/validate
 *
 * body: { code: string }
 * return:
 *   200 { valid: true, trial_days: number }
 *   200 { valid: false, error: string }
 *
 * 注意: コード本体・利用上限などは返さない（列挙攻撃対策）。
 * クーポン全体の一覧 API は意図的に作らない（Service Role のみ触れる）。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    const result = await validatePromoCode(code);

    if (!result.valid) {
      return Response.json({ valid: false, error: result.error });
    }
    return Response.json({
      valid: true,
      trial_days: result.promo.trial_days,
    });
  } catch (e) {
    console.error("[promo/validate] unexpected error:", e);
    return Response.json(
      { valid: false, error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
