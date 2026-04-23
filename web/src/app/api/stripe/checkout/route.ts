import { createClient } from "@supabase/supabase-js";
import { stripe, PRICE_IDS } from "@/lib/stripe";
import { validatePromoCode } from "@/lib/promo";

/**
 * Stripe Checkout Session を作成する
 *
 * フロー:
 *   1. ユーザーのトークンを検証
 *   2. プロフィールに stripe_customer_id が無ければ Stripe 顧客を作成
 *   3. 指定された Price ID でチェックアウトセッションを作成
 *   4. 決済画面のURLを返す
 */
export async function POST(request: Request) {
  try {
    // ── 認証チェック ──
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Invalid token" }, { status: 401 });
    }

    // ── リクエストボディの検証 ──
    const body = await request.json().catch(() => ({}));
    const plan = body.plan as "broadcaster" | "team" | undefined;
    if (plan !== "broadcaster" && plan !== "team") {
      return Response.json({ error: "Invalid plan" }, { status: 400 });
    }
    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return Response.json({ error: "Price ID not configured" }, { status: 500 });
    }

    // ── プロモコード検証（任意） ──
    const rawPromoCode =
      typeof body.promoCode === "string" ? body.promoCode : "";
    let trialDays: number | null = null;
    let normalizedPromoCode: string | null = null;
    if (rawPromoCode.trim()) {
      const promo = await validatePromoCode(rawPromoCode);
      if (!promo.valid) {
        return Response.json({ error: promo.error }, { status: 400 });
      }
      trialDays = promo.promo.trial_days;
      normalizedPromoCode = promo.promo.code;
    }

    // ── プロフィール取得（Service Role で RLS をバイパス） ──
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, display_name")
      .eq("id", user.id)
      .single();

    // ── Stripe 顧客の取得 or 作成 ──
    let customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile?.display_name ?? user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
      if (updateErr) {
        // Stripe 顧客は作成済みのためログに残し、手動リカバリを促す
        console.error(
          "[stripe/checkout] customer created but DB update failed",
          { customerId, userId: user.id, error: updateErr.message }
        );
        return Response.json(
          { error: "Billing setup failed. Please contact support." },
          { status: 500 }
        );
      }
    }

    // ── リダイレクト先のベースURL ──
    const origin = request.headers.get("origin") || new URL(request.url).origin;

    // ── Checkout Session 作成 ──
    const subscriptionMetadata: Record<string, string> = {
      supabase_user_id: user.id,
      plan,
    };
    const sessionMetadata: Record<string, string> = {
      supabase_user_id: user.id,
      plan,
    };
    if (normalizedPromoCode) {
      subscriptionMetadata.promo_code = normalizedPromoCode;
      sessionMetadata.promo_code = normalizedPromoCode;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/mypage?checkout=success`,
      cancel_url: `${origin}/mypage?checkout=cancel`,
      locale: "ja",
      // プロモコード経由でない場合のみ、Stripe ネイティブのプロモコード入力欄を表示
      allow_promotion_codes: normalizedPromoCode ? undefined : true,
      subscription_data: {
        metadata: subscriptionMetadata,
        ...(trialDays !== null ? { trial_period_days: trialDays } : {}),
      },
      metadata: sessionMetadata,
    });

    return Response.json({ url: session.url });
  } catch (e) {
    console.error("Checkout session error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
