import Stripe from "stripe";

// サーバーサイド専用の Stripe クライアント
// シークレットキー（sk_test_... / sk_live_...）を使うため、必ずサーバー側でのみ利用
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // TypeScript で型が安定するように API バージョンを固定。
  // 注意: stripe / @stripe/stripe-js の minor/patch 更新で TS 型側の
  // Stripe.LatestApiVersion がドリフトすることがある (PR #67 で発覚)。
  // Dependabot PR の build が型エラー (Type '"YYYY-MM-DD.dahlia"' is not
  // assignable to type '"NEWER-DATE.dahlia"') で落ちたら、ここの値を
  // エラーメッセージが要求する新版に置き換えるだけで OK。
  // Stripe Backend API は全 version を後方互換でサポートするため、
  // 文字列追従だけで挙動変化なし。詳細は memory feedback_stripe_apiversion_drift.md
  apiVersion: "2026-04-22.dahlia",
  typescript: true,
});

// プランIDのエイリアス
export const PRICE_IDS = {
  broadcaster: process.env.STRIPE_PRICE_STREAMER!,
  team: process.env.STRIPE_PRICE_TEAM!,
} as const;

// Price ID → プラン名の逆引き
export function priceIdToPlan(priceId: string | undefined | null): "broadcaster" | "team" | null {
  if (!priceId) return null;
  if (priceId === PRICE_IDS.broadcaster) return "broadcaster";
  if (priceId === PRICE_IDS.team) return "team";
  return null;
}
