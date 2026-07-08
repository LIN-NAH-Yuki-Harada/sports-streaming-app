import { Resend } from "resend";

/**
 * プラン案内メール（Netflix型の変換funnel）。
 *
 * アプリ内には課金導線を一切置かない（Apple 3.1.1）。プラン・価格・購入リンクは
 * 「メール＋Web」でのみ案内する（Apple が許可する 3.1.3(f) + 2021年のコミュニケーション許容）。
 *
 * 2つの文脈で送る:
 *  - "welcome"   : 新規登録直後（profiles INSERT webhook）。3プランの認知。
 *  - "trial_end" : 無料配信10分を使い切った瞬間（trial-consume API）。やる気MAXの転換ドライバー。
 */

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// 独自ドメイン認証後は noreply@live-spotch.com を使う（env で差し替え）。
const FROM_ADDRESS =
  process.env.RESEND_FROM_EMAIL || "LIVE SPOtCH <onboarding@resend.dev>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://live-spotch.com";
// 初月無料クーポンを案内に含める場合はコードを設定（空なら非表示）。例: "SPOT"
const PROMO_CODE = process.env.WELCOME_PROMO_CODE || "";

export type PlanPitchContext = "welcome" | "trial_end";

/**
 * プラン案内メールを送る。Resend 未設定・メール無し・例外は握りつぶす
 * （呼び出し元の本処理＝登録/トライアル消費 を絶対に止めない）。
 */
export async function sendPlanPitchEmail(params: {
  email: string;
  context: PlanPitchContext;
}): Promise<void> {
  const { email, context } = params;
  if (!email) return;
  if (!resend) {
    console.warn("[plan-pitch] Resend not configured — email skipped");
    return;
  }
  const { subject, html } = buildEmail(context);
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [email],
      subject,
      html,
    });
    if (result.error) {
      console.error(`[plan-pitch:${context}] resend send error:`, result.error);
    }
  } catch (err) {
    console.error(`[plan-pitch:${context}] exception:`, err);
  }
}

function buildEmail(context: PlanPitchContext): {
  subject: string;
  html: string;
} {
  const isTrialEnd = context === "trial_end";

  const subject = isTrialEnd
    ? "無料配信の時間が終了しました｜続けて配信するには"
    : "LIVE SPOtCH へようこそ！配信を始めるには";
  const heading = isTrialEnd
    ? "続けて配信するには"
    : "LIVE SPOtCH へようこそ！";
  const intro = isTrialEnd
    ? `無料でお試しいただける配信時間（10分）を使い切りました。引き続き、お子さんやチームの試合を <b>思う存分ライブ配信</b> するには、プランをお選びください。`
    : `ご登録ありがとうございます。LIVE SPOtCH は、お子さんやチームの試合を、スコアボード付きで <b>TV中継のようにライブ配信・観戦</b> できるアプリです。無料で視聴・お試し配信ができ、<b>思う存分配信する</b>にはプランをお選びください。`;
  const ctaLabel = isTrialEnd ? "プランを選んで続ける" : "プランを選んで始める";

  const pricingUrl = PROMO_CODE
    ? `${SITE_URL}/pricing?promo=${encodeURIComponent(PROMO_CODE)}`
    : `${SITE_URL}/pricing`;
  const promoLine = PROMO_CODE
    ? `<p style="margin:12px 0 0;font-size:13px;color:#e63946;font-weight:600;text-align:center;">初月無料でお試しいただけます。</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:#e63946;color:#fff;padding:20px 24px;">
      <div style="font-size:18px;font-weight:700;letter-spacing:0.02em;">LIVE SPOtCH</div>
    </div>
    <div style="padding:28px 24px;color:#1a1a1a;line-height:1.8;">
      <div style="font-size:20px;font-weight:700;margin-bottom:12px;">${heading}</div>
      <p style="margin:0 0 20px;font-size:14px;">${intro}</p>

      <div style="border:1px solid #eee;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <div style="padding:14px 16px;border-bottom:1px solid #f0f0f0;">
          <div style="font-size:14px;font-weight:700;">無料プラン</div>
          <div style="font-size:13px;color:#666;margin-top:2px;">試合の視聴 ＋ お試し配信</div>
        </div>
        <div style="padding:14px 16px;border-bottom:1px solid #f0f0f0;">
          <div style="font-size:14px;font-weight:700;">配信者プラン <span style="color:#e63946;">月額 ¥300</span></div>
          <div style="font-size:13px;color:#666;margin-top:2px;">配信し放題。スコアボード・共有も自由に。</div>
        </div>
        <div style="padding:14px 16px;">
          <div style="font-size:14px;font-weight:700;">チームプラン <span style="color:#e63946;">月額 ¥500</span></div>
          <div style="font-size:13px;color:#666;margin-top:2px;">配信し放題 ＋ チーム管理 ＋ YouTube同時配信・自動アーカイブ</div>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:8px;">
        <a href="${pricingUrl}" style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;">
          ${ctaLabel}
        </a>
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#999;text-align:center;">いつでも退会できます（ボタンひとつ）。</p>
      ${promoLine}

      <p style="margin:28px 0 0;font-size:12px;color:#999;">
        このメールに心当たりがない場合は、お手数ですが
        <a href="${SITE_URL}/contact" style="color:#e63946;text-decoration:none;">こちら</a>
        までお知らせください。
      </p>
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #eee;color:#999;font-size:11px;line-height:1.7;">
      LIVE SPOtCH（運営：LIN-NAH株式会社）<br>
      <a href="${SITE_URL}/terms" style="color:#999;">利用規約</a> ・
      <a href="${SITE_URL}/privacy" style="color:#999;">プライバシーポリシー</a>
    </div>
  </div>
</body></html>`;

  return { subject, html };
}
