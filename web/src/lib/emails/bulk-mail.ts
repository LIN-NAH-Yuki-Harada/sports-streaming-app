import { Resend } from "resend";
import { getAdminClient } from "@/lib/supabase-admin";

/**
 * 管理画面からの一斉送信。
 *
 * ■ なぜ BCC ではなくこの仕組みが必要か
 * Gmail の BCC で送ると、**Apple の非公開メール（@privaterelay.appleid.com）に届かない**。
 * Apple は送信元ドメインが登録されていないメールを**エラーも返さず破棄する**。
 * 当社は live-spotch.com / send.live-spotch.com を登録済みなので、
 * そこから送る限り届く（2026-08-14 対応）。gmail.com は登録されていないため届かない。
 * 実際に配信者77名のうち18名が privaterelay で、その中には課金者も含まれる。
 *
 * ■ 一人ずつ送る（BCC にしない）
 * Resend の batch API を使い、宛先ごとに独立したメールとして送る。
 * BCC は他人のアドレスが見える事故が起きるうえ、迷惑メール判定も受けやすい。
 */

const BATCH_SIZE = 100; // Resend の batch API の上限
const resendApiKey = process.env.RESEND_API_KEY;

export type Audience = "broadcasters" | "paying" | "all";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  broadcasters: "配信したことがある人",
  paying: "課金中の人",
  all: "登録者全員",
};

export function isAudience(v: unknown): v is Audience {
  return v === "broadcasters" || v === "paying" || v === "all";
}

/** 送信元。★未設定なら送らない（共有テストドメインから送ると本人にしか届かない事故になる）。 */
export function getFromAddress(): string | null {
  return process.env.RESEND_FROM_EMAIL || null;
}

/**
 * 返信先。live-spotch.com は MX が無く**返信を受け取れない**ため、
 * 実在するアドレスを Reply-To に必ず入れる（入れないと返信が消える）。
 */
export function getReplyTo(): string | undefined {
  return (
    process.env.CONTACT_NOTIFICATION_EMAIL ||
    process.env.ALERT_NOTIFICATION_EMAIL ||
    undefined
  );
}

export type Recipient = { id: string; email: string; name: string | null };

/**
 * 送信対象を解決する。
 *
 * ★重要: 宛先は**必ずサーバー側で組み立てる**。画面から渡されたリストを信用しない
 *   （改ざんで無関係の人に送れてしまうため）。
 */
export async function resolveRecipients(
  audience: Audience,
): Promise<Recipient[]> {
  const admin = getAdminClient();

  // 対象になり得る profiles を集める
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, subscription_status")
    .limit(5000);
  const all = (profiles ?? []) as {
    id: string;
    display_name: string | null;
    subscription_status: string | null;
  }[];

  let ids: Set<string>;
  if (audience === "paying") {
    ids = new Set(
      all.filter((p) => p.subscription_status === "active").map((p) => p.id),
    );
  } else if (audience === "broadcasters") {
    const { data: bs } = await admin
      .from("broadcasts")
      .select("broadcaster_id")
      .limit(20000);
    ids = new Set(
      ((bs ?? []) as { broadcaster_id: string }[]).map((b) => b.broadcaster_id),
    );
  } else {
    ids = new Set(all.map((p) => p.id));
  }

  const nameById = new Map(all.map((p) => [p.id, p.display_name]));

  // メールアドレスは auth 側にしか無いので Admin API から引く
  const { data: users, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const u of users.users) {
    if (!ids.has(u.id)) continue;
    const email = (u.email ?? "").trim();
    if (!email) continue; // メール未登録（電話番号ログイン等）は対象外
    const key = email.toLowerCase();
    if (seen.has(key)) continue; // 同じアドレスに二重送信しない
    seen.add(key);
    out.push({ id: u.id, email, name: nameById.get(u.id) ?? null });
  }
  return out;
}

/** プレーンテキストの本文を、そのまま読める最小限の HTML に変換する。 */
export function renderHtml(subject: string, body: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const paragraphs = esc(body)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;line-height:1.8">${p.replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  return `<!doctype html><html lang="ja"><body style="margin:0;padding:24px;background:#f6f6f6">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
  <div style="background:#e63946;color:#fff;padding:16px 24px;font-weight:700">LIVE SPOtCH</div>
  <div style="padding:24px;color:#222;font-size:15px;font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif">
    ${paragraphs}
  </div>
  <div style="padding:16px 24px;border-top:1px solid #eee;color:#888;font-size:12px">
    LIVE SPOtCH ／ このメールへ返信いただけます
  </div>
</div></body></html>`;
}

export type SendResult = { email: string; ok: boolean; error?: string };

/** 宛先へ一斉送信する（100件ずつに分けて Resend の batch API を使う）。 */
export async function sendBulk(
  recipients: Recipient[],
  subject: string,
  body: string,
): Promise<SendResult[]> {
  const from = getFromAddress();
  if (!resendApiKey || !from) {
    throw new Error(
      "RESEND_API_KEY または RESEND_FROM_EMAIL が未設定です（送信を中止しました）",
    );
  }
  const resend = new Resend(resendApiKey);
  const replyTo = getReplyTo();
  const html = renderHtml(subject, body);
  const results: SendResult[] = [];

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    try {
      const res = await resend.batch.send(
        chunk.map((r) => ({
          from,
          to: [r.email],
          subject,
          html,
          ...(replyTo ? { replyTo } : {}),
        })),
      );
      if (res.error) {
        for (const r of chunk)
          results.push({ email: r.email, ok: false, error: res.error.message });
      } else {
        for (const r of chunk) results.push({ email: r.email, ok: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const r of chunk) results.push({ email: r.email, ok: false, error: msg });
    }
  }
  return results;
}
