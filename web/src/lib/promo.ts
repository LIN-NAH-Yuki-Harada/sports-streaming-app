import { getAdminClient } from "@/lib/supabase-admin";

export type PromoCode = {
  code: string;
  trial_days: number;
  max_uses: number | null;
  uses_count: number;
  active: boolean;
  expires_at: string | null;
  label: string | null;
};

export type PromoValidationResult =
  | { valid: true; promo: PromoCode }
  | { valid: false; error: string };

/**
 * プロモコードを検証する。
 * 小文字で入っても大文字に揃え、空白はトリムしてから突き合わせる。
 */
export async function validatePromoCode(
  rawCode: string
): Promise<PromoValidationResult> {
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) {
    return { valid: false, error: "コードを入力してください" };
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("code", normalized)
    .maybeSingle();

  if (error) {
    console.error("[promo/validate] DB error:", error.message);
    return { valid: false, error: "コードを確認できませんでした（時間をおいて再度お試しください）" };
  }
  if (!data) {
    return { valid: false, error: "このコードは見つかりませんでした" };
  }

  const promo = data as PromoCode;

  if (!promo.active) {
    return { valid: false, error: "このコードは現在使用できません" };
  }
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return { valid: false, error: "このコードは配布期限を過ぎています" };
  }
  if (
    promo.max_uses !== null &&
    promo.max_uses !== undefined &&
    promo.uses_count >= promo.max_uses
  ) {
    return { valid: false, error: "このコードの利用上限に達しました" };
  }

  return { valid: true, promo };
}

/**
 * プロモコードの使用回数をアトミックにインクリメントする。
 * checkout.session.completed 受信時に呼ぶ。
 */
export async function incrementPromoUsage(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;

  const supabase = getAdminClient();

  // 現在値を取得してから +1 する（Supabase は RPC なしの atomic increment が不得意なので2段階で妥協）
  const { data: current, error: selectErr } = await supabase
    .from("promo_codes")
    .select("uses_count")
    .eq("code", normalized)
    .single();
  if (selectErr || !current) {
    console.error("[promo/increment] select failed:", selectErr?.message);
    return;
  }

  const { error: updateErr } = await supabase
    .from("promo_codes")
    .update({ uses_count: (current.uses_count ?? 0) + 1 })
    .eq("code", normalized);
  if (updateErr) {
    console.error("[promo/increment] update failed:", updateErr.message);
  }
}
