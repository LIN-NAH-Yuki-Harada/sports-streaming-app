import { createClient } from "@supabase/supabase-js";

// RevenueCat の署名検証/DB更新は Node ランタイムで動かす
export const runtime = "nodejs";

/**
 * RevenueCat Webhook ハンドラ（Apple IAP → profiles.plan 反映）
 *
 * iOS アプリ内課金（StoreKit）の購入/更新/失効を RevenueCat が POST してくる。
 * Stripe webhook と同型で、ユーザーの profiles.plan を更新する。機能ゲートは
 * すべて profiles.plan を読むだけなので、これで Web(Stripe)/iOS(IAP) が統一される。
 *
 * 認証: RevenueCat の Webhook 設定で指定した Authorization ヘッダ値と照合
 *       （env REVENUECAT_WEBHOOK_AUTH）。
 * 対応付け: app_user_id = Supabase user.id（アプリが Purchases.logIn(user.id) で設定）。
 *           product_id → plan は env で設定（REVENUECAT_PRODUCT_BROADCASTER / _TEAM）。
 *           フォールバックで RevenueCat entitlement 名（"broadcaster"/"team"）でも判定。
 *
 * 二重課金ソース保護: IAP 失効時、Stripe で課金中なら降格しない。
 */

const ACTIVE_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);

function productToPlan(
  productId: string | null | undefined,
  entitlementIds: string[] | null | undefined,
): "broadcaster" | "team" | null {
  // Google Play の product_id は "{subscriptionId}:{basePlanId}"（例 "team_monthly:monthly"）で
  // 届くため、basePlanId 接尾辞を落としてから比較する（クライアント側 558fb58 と同じ正規化のサーバー版）。
  // iOS は接尾辞なしなので split は無害。env 側に接尾辞付きで設定されていても同様に吸収する。
  const baseId = productId ? productId.split(":")[0] : null;
  const team = process.env.REVENUECAT_PRODUCT_TEAM?.split(":")[0];
  const broadcaster = process.env.REVENUECAT_PRODUCT_BROADCASTER?.split(":")[0];
  if (baseId && team && baseId === team) return "team";
  if (baseId && broadcaster && baseId === broadcaster) return "broadcaster";
  // フォールバック: RevenueCat の entitlement 名で判定
  if (entitlementIds?.includes("team")) return "team";
  if (entitlementIds?.includes("broadcaster")) return "broadcaster";
  return null;
}

export async function POST(request: Request) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    console.error("[rc-webhook] REVENUECAT_WEBHOOK_AUTH is not set");
    return new Response("Webhook auth not configured", { status: 500 });
  }
  // RevenueCat は設定した Authorization ヘッダ値をそのまま送る
  if (request.headers.get("authorization") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { event?: Record<string, unknown> };
  try {
    payload = (await request.json()) as { event?: Record<string, unknown> };
  } catch {
    return new Response("Invalid body", { status: 400 });
  }

  const event = payload?.event;
  const type = typeof event?.type === "string" ? event.type : null;
  if (!event || !type) {
    return Response.json({ skipped: "no-event" });
  }

  const userId = typeof event.app_user_id === "string" ? event.app_user_id : null;
  // 匿名ID（$RCAnonymousID:...）や未ログインは対応付け不可なのでスキップ
  if (!userId || userId.startsWith("$RCAnonymousID")) {
    return Response.json({ skipped: "no-user", type });
  }

  const productId = typeof event.product_id === "string" ? event.product_id : null;
  const entitlementIds = Array.isArray(event.entitlement_ids)
    ? (event.entitlement_ids as string[])
    : null;
  const expirationMs = typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
  const periodEnd = expirationMs ? new Date(expirationMs).toISOString() : null;
  const originalTxId =
    typeof event.original_transaction_id === "string"
      ? event.original_transaction_id
      : typeof event.transaction_id === "string"
        ? event.transaction_id
        : null;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    if (ACTIVE_TYPES.has(type)) {
      const plan = productToPlan(productId, entitlementIds);
      if (!plan) {
        console.warn("[rc-webhook] unknown product/entitlement", { productId, entitlementIds, type });
        return Response.json({ skipped: "unknown-product" });
      }
      const { error } = await admin
        .from("profiles")
        .update({
          plan,
          subscription_status: "active",
          current_period_end: periodEnd,
          iap_product_id: productId,
          iap_original_transaction_id: originalTxId,
        })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      return Response.json({ received: true, plan });
    }

    if (type === "BILLING_ISSUE") {
      // 支払い問題（猶予期間中）。プランは維持しステータスのみ更新。
      const { error } = await admin
        .from("profiles")
        .update({ subscription_status: "past_due" })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      return Response.json({ received: true });
    }

    if (type === "EXPIRATION") {
      // 失効。ただし Stripe で課金中なら降格しない（二重ソース保護）。
      const { data: prof } = await admin
        .from("profiles")
        .select("stripe_subscription_id")
        .eq("id", userId)
        .single();
      if (prof?.stripe_subscription_id) {
        await admin
          .from("profiles")
          .update({ iap_product_id: null, iap_original_transaction_id: null })
          .eq("id", userId);
        return Response.json({ received: true, note: "kept (active stripe sub)" });
      }
      const { error } = await admin
        .from("profiles")
        .update({
          plan: "free",
          subscription_status: "expired",
          current_period_end: null,
          iap_product_id: null,
          iap_original_transaction_id: null,
        })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      return Response.json({ received: true, downgraded: true });
    }

    // CANCELLATION（自動更新OFF・期限までは利用可）/ TEST / その他は据え置き
    console.log(`[rc-webhook] no-op event: ${type}`);
    return Response.json({ received: true, noop: type });
  } catch (e) {
    console.error("[rc-webhook] handler error:", e instanceof Error ? e.message : e);
    return new Response("Webhook handler error", { status: 500 });
  }
}
