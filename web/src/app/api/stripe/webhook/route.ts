import { createClient } from "@supabase/supabase-js";
import { stripe, priceIdToPlan } from "@/lib/stripe";
import { incrementPromoUsage } from "@/lib/promo";
import type Stripe from "stripe";

/**
 * Stripe Webhook ハンドラ
 *
 * Stripe は決済成否・サブスク変更などのイベントを POST してくる。
 * 署名検証でなりすましを防ぎ、ユーザーのプランを更新する。
 *
 * 受け取るイベント:
 *   - checkout.session.completed: チェックアウト完了 → サブスク開始
 *   - customer.subscription.updated: サブスク更新（プラン変更等）
 *   - customer.subscription.deleted: サブスク解約 → free プランへ
 *   - invoice.paid: 定期支払い成功（継続課金）
 *   - invoice.payment_failed: 定期支払い失敗
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  // 署名検証のため raw body を使う必要がある
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("Webhook signature verification failed:", message);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  // Service Role で RLS をバイパスしてプロフィール更新
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        if (!userId || !session.subscription) break;

        // サブスク詳細を取得してPriceからプランを判定
        const subscription = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string" ? session.subscription : session.subscription.id
        );
        const priceId = subscription.items.data[0]?.price.id;
        const plan = priceIdToPlan(priceId);
        if (!plan) {
          console.warn("Unknown price ID:", priceId);
          break;
        }

        const { error: updateErr } = await supabaseAdmin
          .from("profiles")
          .update({
            plan,
            stripe_customer_id:
              typeof session.customer === "string" ? session.customer : session.customer?.id,
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            current_period_end: subscription.items.data[0]?.current_period_end
              ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
              : null,
          })
          .eq("id", userId);
        if (updateErr) {
          console.error("[stripe-webhook] checkout.session.completed update failed:", updateErr.message, { userId });
          throw new Error(`profiles update failed: ${updateErr.message}`);
        }

        // プロモコード経由なら使用回数をインクリメント（失敗はログのみ、Checkout の成功は確定させる）
        const promoCode = session.metadata?.promo_code;
        if (promoCode) {
          await incrementPromoUsage(promoCode);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;

        const priceId = sub.items.data[0]?.price.id;
        const plan = priceIdToPlan(priceId);

        // subscription_status / current_period_end / subscription_id は常に最新化する。
        // ただし plan は priceId が判定できたときだけ更新する。
        // 旧実装では `priceIdToPlan(priceId) || "free"` としていたため、
        // priceId が undefined（タイミング遅延）や登録された PRICE_IDS と一致しないケースで
        // 課金中の team/broadcaster ユーザーが意図せず free に強制ダウングレードされる事故が発生していた。
        // plan を据え置けば、未知の priceId が来ても現状の権限が剥奪されない。
        const baseUpdate: Record<string, string | null> = {
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: sub.items.data[0]?.current_period_end
            ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
            : null,
        };
        if (plan) {
          baseUpdate.plan = plan;
        } else {
          console.warn(
            "[stripe-webhook] customer.subscription.updated: unknown priceId, plan kept as-is",
            { priceId, userId, subscriptionId: sub.id, status: sub.status }
          );
        }

        const { error: updateErr } = await supabaseAdmin
          .from("profiles")
          .update(baseUpdate)
          .eq("id", userId);
        if (updateErr) {
          console.error("[stripe-webhook] customer.subscription.updated update failed:", updateErr.message, { userId });
          throw new Error(`profiles update failed: ${updateErr.message}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;

        const { error: updateErr } = await supabaseAdmin
          .from("profiles")
          .update({
            plan: "free",
            stripe_subscription_id: null,
            subscription_status: "canceled",
            current_period_end: null,
          })
          .eq("id", userId);
        if (updateErr) {
          console.error("[stripe-webhook] customer.subscription.deleted update failed:", updateErr.message, { userId });
          throw new Error(`profiles update failed: ${updateErr.message}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (!customerId) break;
        const { error: updateErr } = await supabaseAdmin
          .from("profiles")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customerId);
        if (updateErr) {
          console.error("[stripe-webhook] invoice.payment_failed update failed:", updateErr.message, { customerId });
          throw new Error(`profiles update failed: ${updateErr.message}`);
        }
        break;
      }

      default:
        // その他のイベントはログのみ
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return Response.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return new Response("Webhook handler error", { status: 500 });
  }
}
