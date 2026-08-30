import { requireAdmin } from "@/lib/admin-auth";
import { getAdminClient } from "@/lib/supabase-admin";
import {
  AUDIENCE_LABEL,
  getFromAddress,
  getReplyTo,
  isAudience,
  resolveRecipients,
  sendBulk,
  type Audience,
} from "@/lib/emails/bulk-mail";

export const runtime = "nodejs";
// 一斉送信は宛先数に比例して時間がかかる。既定の実行時間で足りるが、余裕を持たせる。
export const maxDuration = 300;

/**
 * 管理者向けの一斉送信API。
 *
 * ★安全装置（ボタン1つで全員に飛ぶ機能なので、事故を「構造」で防ぐ）
 *   1. **テスト送信をしないと本送信できない。**
 *      mode=test で campaign 行を作り、その id を持っている行にしか本送信できない。
 *   2. **人数が一致しないと送らない。** 画面が表示していた人数と、送信直前に
 *      サーバーが数え直した人数が違えば中止する（画面が古いまま送る事故を防ぐ）。
 *   3. **二重送信できない。** sent_at が入っている行は拒否する。
 *   4. **宛先はサーバーが組み立てる。** 画面から渡されたアドレスは一切使わない。
 */

type PostBody = {
  mode?: "test" | "send";
  subject?: string;
  body?: string;
  audience?: string;
  campaignId?: string;
  expectedCount?: number;
};

/** 送信対象の人数（画面の表示用）。 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const counts: Record<string, number> = {};
  for (const a of ["broadcasters", "paying", "all"] as Audience[]) {
    counts[a] = (await resolveRecipients(a)).length;
  }
  return Response.json({
    counts,
    labels: AUDIENCE_LABEL,
    from: getFromAddress(),
    replyTo: getReplyTo() ?? null,
    // 送信元が未設定なら画面で止める（共有テストドメインから送ると本人にしか届かない）
    ready: Boolean(getFromAddress() && process.env.RESEND_API_KEY),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const subject = (body.subject ?? "").trim();
  const text = (body.body ?? "").trim();
  if (!subject || !text) {
    return Response.json({ error: "件名と本文を入力してください" }, { status: 400 });
  }
  if (!isAudience(body.audience)) {
    return Response.json({ error: "送信対象が不正です" }, { status: 400 });
  }
  const audience = body.audience;
  const admin = getAdminClient();

  // ── テスト送信: 自分にだけ送り、campaign 行を作る ──────────────────
  if (body.mode === "test") {
    const myEmail = auth.user.email;
    if (!myEmail) {
      return Response.json(
        { error: "管理者アカウントにメールアドレスがありません" },
        { status: 400 },
      );
    }
    try {
      const results = await sendBulk(
        [{ id: auth.user.id, email: myEmail, name: null }],
        `[テスト] ${subject}`,
        text,
      );
      if (!results[0]?.ok) {
        return Response.json(
          { error: `テスト送信に失敗しました: ${results[0]?.error ?? "不明"}` },
          { status: 502 },
        );
      }
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "送信に失敗しました" },
        { status: 500 },
      );
    }

    const { data, error } = await admin
      .from("email_campaigns")
      .insert({
        subject,
        body: text,
        audience,
        test_sent_at: new Date().toISOString(),
        created_by: auth.user.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      return Response.json(
        { error: `記録に失敗しました: ${error?.message ?? "不明"}` },
        { status: 500 },
      );
    }
    return Response.json({
      ok: true,
      campaignId: (data as { id: string }).id,
      testedTo: myEmail,
    });
  }

  // ── 本送信 ────────────────────────────────────────────────
  if (body.mode !== "send") {
    return Response.json({ error: "mode が不正です" }, { status: 400 });
  }
  if (!body.campaignId) {
    return Response.json(
      { error: "先にテスト送信をしてください" },
      { status: 400 },
    );
  }

  const { data: row, error: readErr } = await admin
    .from("email_campaigns")
    .select("id, subject, body, audience, test_sent_at, sent_at")
    .eq("id", body.campaignId)
    .single();
  if (readErr || !row) {
    return Response.json({ error: "送信内容が見つかりません" }, { status: 404 });
  }
  const c = row as {
    id: string;
    subject: string;
    body: string;
    audience: string;
    test_sent_at: string | null;
    sent_at: string | null;
  };
  if (!c.test_sent_at) {
    return Response.json(
      { error: "テスト送信が完了していません" },
      { status: 400 },
    );
  }
  if (c.sent_at) {
    return Response.json(
      { error: "この内容はすでに送信済みです（二重送信は行いません）" },
      { status: 409 },
    );
  }
  // 文面を差し替えて送る抜け道を塞ぐ。送るのは**テストしたそのもの**だけ。
  if (c.subject !== subject || c.body !== text || c.audience !== audience) {
    return Response.json(
      {
        error:
          "テスト送信したあとに内容が変わっています。もう一度テスト送信してください",
      },
      { status: 409 },
    );
  }

  const recipients = await resolveRecipients(audience);
  if (recipients.length === 0) {
    return Response.json({ error: "宛先が0件です" }, { status: 400 });
  }
  // 画面が表示していた人数と食い違う＝画面が古い。送らずに中止する。
  if (
    typeof body.expectedCount === "number" &&
    body.expectedCount !== recipients.length
  ) {
    return Response.json(
      {
        error: `宛先数が変わりました（画面: ${body.expectedCount}名 / 現在: ${recipients.length}名）。画面を再読み込みしてやり直してください`,
      },
      { status: 409 },
    );
  }

  // 送信直前に sent_at を立てて二重送信を防ぐ（同時押し・リトライ対策）。
  // ★CAS: sent_at が null の行だけを更新する。1行も更新できなければ他で送信済み。
  const { data: locked, error: lockErr } = await admin
    .from("email_campaigns")
    .update({ sent_at: new Date().toISOString(), recipient_count: recipients.length })
    .eq("id", c.id)
    .is("sent_at", null)
    .select("id");
  if (lockErr || !locked || locked.length === 0) {
    return Response.json(
      { error: "すでに送信処理が始まっています" },
      { status: 409 },
    );
  }

  let results;
  try {
    results = await sendBulk(recipients, subject, text);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "送信に失敗しました" },
      { status: 500 },
    );
  }
  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  await admin
    .from("email_campaigns")
    .update({ sent_count: sent, failed_count: failed, results })
    .eq("id", c.id);

  return Response.json({
    ok: true,
    recipientCount: recipients.length,
    sent,
    failed,
    failures: results.filter((r) => !r.ok).slice(0, 20),
  });
}
