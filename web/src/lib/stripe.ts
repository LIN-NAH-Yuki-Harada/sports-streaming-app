import Stripe from "stripe";

// サーバーサイド専用の Stripe クライアント
// シークレットキー（sk_test_... / sk_live_...）を使うため、必ずサーバー側でのみ利用
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // TypeScriptで型が安定するように API バージョンを固定
  apiVersion: "2026-03-25.dahlia",
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
