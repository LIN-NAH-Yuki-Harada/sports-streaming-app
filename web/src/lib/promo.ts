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
 *
 * Postgres 側の RPC 関数 increment_promo_usage が単一 UPDATE で実行されるため、
 * 同時 checkout が走っても lost update は発生しない（旧: SELECT→+1→UPDATE の
 * 3 段階で race condition があり、uses_count が正しく加算されないことがあった）。
 */
export async function incrementPromoUsage(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;

  const supabase = getAdminClient();
  const { error } = await supabase.rpc("increment_promo_usage", {
    promo_code: normalized,
  });
  if (error) {
    console.error("[promo/increment] rpc failed:", error.message);
  }
}
