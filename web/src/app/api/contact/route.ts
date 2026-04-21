import { getAdminClient } from "@/lib/supabase-admin";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_ADDRESS = "LIVE SPOtCH <onboarding@resend.dev>";

export async function POST(request: Request) {
  try {
    const { name, email, message } = await request.json();

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return Response.json({ error: "All fields are required" }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return Response.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (name.trim().length > 100 || message.trim().length > 5000) {
      return Response.json({ error: "Input too long" }, { status: 400 });
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    const admin = getAdminClient();
    const { error } = await admin.from("contact_messages").insert({
      name: trimmedName,
      email: trimmedEmail,
      message: trimmedMessage,
    });

    if (error) {
      console.error("Contact message save error:", error);
      return Response.json({ error: "Failed to save message" }, { status: 500 });
    }

    // 管理者通知メール送信。Resend の onboarding@resend.dev は独自ドメイン
    // 認証前はアカウント所有者のメール宛のみ可。ユーザーへの自動返信は独自
    // ドメイン認証後に追加する。
    const adminEmail = process.env.CONTACT_NOTIFICATION_EMAIL;
    if (resend && adminEmail) {
      try {
        const result = await resend.emails.send({
          from: FROM_ADDRESS,
          to: [adminEmail],
          replyTo: trimmedEmail,
          subject: `[LIVE SPOtCH] 新しいお問い合わせ - ${trimmedName}様`,
          html: buildAdminHtml(trimmedName, trimmedEmail, trimmedMessage),
        });
        if (result.error) {
          console.error("[contact] resend send error:", result.error);
        }
      } catch (err) {
        console.error("[contact] resend exception:", err);
      }
    } else {
      console.warn(
        "[contact] Resend not configured — email skipped (RESEND_API_KEY or CONTACT_NOTIFICATION_EMAIL missing)"
      );
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("Contact API error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
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

function buildAdminHtml(name: string, email: string, message: string) {
  return `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:#e63946;color:#fff;padding:16px 24px;">
      <div style="font-size:14px;font-weight:600;letter-spacing:0.02em;">LIVE SPOtCH</div>
      <div style="font-size:11px;opacity:0.9;margin-top:2px;">新しいお問い合わせ</div>
    </div>
    <div style="padding:24px;color:#1a1a1a;line-height:1.7;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:8px 0;color:#888;width:120px;">お名前</td>
          <td style="padding:8px 0;">${escapeHtml(name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#888;border-top:1px solid #eee;">メール</td>
          <td style="padding:8px 0;border-top:1px solid #eee;"><a href="mailto:${escapeHtml(email)}" style="color:#e63946;text-decoration:none;">${escapeHtml(email)}</a></td>
        </tr>
      </table>
      <div style="margin-top:20px;color:#888;font-size:12px;">お問い合わせ内容</div>
      <div style="margin-top:8px;background:#f9f9f9;padding:16px;border-radius:8px;white-space:pre-wrap;font-size:14px;">${escapeHtml(message)}</div>
      <p style="margin-top:24px;font-size:12px;color:#888;">このメールに直接返信すると、${escapeHtml(email)} 宛に送信されます。</p>
    </div>
  </div>
</body></html>`;
}
