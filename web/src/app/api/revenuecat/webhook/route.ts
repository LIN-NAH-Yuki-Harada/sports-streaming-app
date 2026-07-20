import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

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
 *
 * 取りこぼし検知（安全網）: 実購入なのに profiles に反映できないケース
 *   ①app_user_id が匿名（logIn 未成立の購入）②商品/entitlement が未対応、は
 *   これまで黙ってスキップしていた＝顧客が問い合わせるまで気づけなかった。
 *   これらを検知したらオーナーにアラートメールを送り、手動反映のトリガーにする。
 */

const ACTIVE_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);

const RESEND_FROM = "LIVE SPOtCH <onboarding@resend.dev>";

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

/**
 * 反映できない実購入をオーナーに通知する（best-effort）。
 * アラート送信の失敗で webhook 本体を落とさない。
 */
async function sendUnmatchedPurchaseAlert(info: {
  reason: "anonymous-user" | "unknown-product";
  type: string;
  productId: string | null;
  appUserId: string | null;
  originalTxId: string | null;
  store: string | null;
  eventId: string | null;
}): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const to =
      process.env.ALERT_NOTIFICATION_EMAIL ??
      process.env.CONTACT_NOTIFICATION_EMAIL;
    if (!apiKey || !to) {
      console.warn(
        "[rc-webhook] unmatched-purchase alert skipped — RESEND_API_KEY or ALERT/CONTACT_NOTIFICATION_EMAIL missing",
        info,
      );
      return;
    }
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: RESEND_FROM,
      to: [to],
      subject: `[LIVE SPOtCH] ⚠️ 反映できない課金を検知（${info.type}）`,
      html: buildUnmatchedAlertHtml(info),
    });
    if (result.error) {
      console.error("[rc-webhook] alert resend error:", result.error);
    }
  } catch (err) {
    console.error("[rc-webhook] alert exception:", err);
  }
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
  const productId = typeof event.product_id === "string" ? event.product_id : null;
  const entitlementIds = Array.isArray(event.entitlement_ids)
    ? (event.entitlement_ids as string[])
    : null;
  const expirationMs = typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
  const periodEnd = expirationMs ? new Date(expirationMs).toISOString() : null;
  const store = typeof event.store === "string" ? event.store : null;
  const eventId = typeof event.id === "string" ? event.id : null;
  const originalTxId =
    typeof event.original_transaction_id === "string"
      ? event.original_transaction_id
      : typeof event.transaction_id === "string"
        ? event.transaction_id
        : null;

  // 匿名ID（$RCAnonymousID:...）や未ログインは対応付け不可なのでスキップ。
  // ただし実購入（ACTIVE_TYPES）なら「取りこぼした課金」なのでオーナーに通知する
  // （logIn 未成立のまま購入されたケース＝手動反映が必要）。
  if (!userId || userId.startsWith("$RCAnonymousID")) {
    if (ACTIVE_TYPES.has(type)) {
      await sendUnmatchedPurchaseAlert({
        reason: "anonymous-user",
        type,
        productId,
        appUserId: userId,
        originalTxId,
        store,
        eventId,
      });
    }
    return Response.json({ skipped: "no-user", type });
  }

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
        // 実購入なのに商品/entitlement が未対応＝反映できない課金なので通知する。
        await sendUnmatchedPurchaseAlert({
          reason: "unknown-product",
          type,
          productId,
          appUserId: userId,
          originalTxId,
          store,
          eventId,
        });
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

function escapeHtml(s: string) {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function buildUnmatchedAlertHtml(info: {
  reason: "anonymous-user" | "unknown-product";
  type: string;
  productId: string | null;
  appUserId: string | null;
  originalTxId: string | null;
  store: string | null;
  eventId: string | null;
}) {
  const reasonLabel =
    info.reason === "anonymous-user"
      ? "購入がユーザーに紐付いていません（匿名 app_user_id）"
      : "購入商品がプランに対応していません（未知の product/entitlement）";
  const rows: [string, string | null][] = [
    ["理由", reasonLabel],
    ["イベント種別", info.type],
    ["ストア", info.store],
    ["商品ID", info.productId],
    ["app_user_id", info.appUserId],
    ["取引ID", info.originalTxId],
    ["イベントID", info.eventId],
  ];
  const rowsHtml = rows
    .map(
      ([label, value], i) => `
        <tr>
          <td style="padding:8px 0;color:#888;width:130px;${i > 0 ? "border-top:1px solid #eee;" : ""}">${escapeHtml(label)}</td>
          <td style="padding:8px 0;${i > 0 ? "border-top:1px solid #eee;" : ""}font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;">${value ? escapeHtml(value) : "—"}</td>
        </tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:#e63946;color:#fff;padding:16px 24px;">
      <div style="font-size:14px;font-weight:600;letter-spacing:0.02em;">LIVE SPOtCH</div>
      <div style="font-size:11px;opacity:0.9;margin-top:2px;">⚠️ 反映できない課金を検知しました</div>
    </div>
    <div style="padding:24px;color:#1a1a1a;line-height:1.7;">
      <p style="margin:0 0 16px;font-size:14px;">
        RevenueCat から実購入イベントを受信しましたが、<strong>プラン（profiles.plan）に自動反映できませんでした</strong>。
        課金は成立している可能性が高いため、下記を手掛かりに手動で反映してください。
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rowsHtml}
      </table>
      <div style="margin-top:20px;background:#fff5f5;border:1px solid #ffd6d6;padding:16px;border-radius:8px;font-size:13px;color:#7a1a1a;">
        <strong>対応手順</strong><br/>
        1. RevenueCat の Customers で上記 app_user_id / 取引ID の顧客を特定<br/>
        2. Supabase Auth で本人のメールから id を取得<br/>
        3. profiles の該当行の <code>plan</code> を購入プラン（team / broadcaster）、<code>subscription_status</code> を <code>active</code> に更新
      </div>
    </div>
  </div>
</body></html>`;
}
