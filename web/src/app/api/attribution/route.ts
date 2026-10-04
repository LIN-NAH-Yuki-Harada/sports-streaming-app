import { getAdminClient, getUser } from "@/lib/supabase-admin";

// 新規登録の直後に、初回訪問の情報（lib/attribution.ts の first-touch）を
// profiles.signup_* に1回だけ書く。
//
// - 書くのは「登録から24時間以内」かつ「まだ signup_source が空」のときだけ（再ログインや改ざんで上書きさせない）
// - signup_* はクライアントに SELECT 権限を付けていない（他人の登録経路を見せない）
// - 失敗しても登録・ログインには一切影響させない（呼び出し側は fire-and-forget）

const MAX_SIGNUP_AGE_MS = 24 * 60 * 60 * 1000;

function clip(v: unknown, max = 100): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// 参照元ドメインを集計しやすい名前にまとめる
function sourceFromReferrer(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("google.")) return "google";
  if (h.includes("yahoo.")) return "yahoo";
  if (h.includes("bing.")) return "bing";
  if (h.includes("instagram.")) return "instagram";
  if (h.includes("facebook.") || h === "fb.me" || h.endsWith(".fb.com")) return "facebook";
  if (h.includes("threads.")) return "threads";
  if (h.includes("tiktok.")) return "tiktok";
  if (h.includes("youtube.") || h === "youtu.be") return "youtube";
  if (h === "t.co" || h === "x.com" || h.endsWith(".x.com") || h.includes("twitter.")) return "x";
  if (h.includes("line.me") || h.includes("line-apps")) return "line";
  if (h.includes("note.com")) return "note";
  if (h.includes("prtimes.")) return "prtimes";
  return h;
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const createdAtMs = user.created_at ? new Date(user.created_at).getTime() : 0;
    if (!createdAtMs || Date.now() - createdAtMs > MAX_SIGNUP_AGE_MS) {
      return Response.json({ ok: true, skipped: "not_new" });
    }

    const body = await request.json().catch(() => ({}));
    const utmSource = clip(body?.utm_source);
    const landing = clip(body?.landing_path, 200);
    const referrer = clip(body?.referrer_host);

    // 決め方: utm_source > 着地が視聴ページ > 参照元 > 直接
    let source = "direct";
    if (utmSource) source = utmSource.toLowerCase();
    else if (landing?.startsWith("/watch/")) source = "watch";
    else if (referrer) source = sourceFromReferrer(referrer);

    const admin = getAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({
        signup_source: source,
        signup_medium: clip(body?.utm_medium),
        signup_campaign: clip(body?.utm_campaign),
        signup_landing: landing,
        signup_referrer: referrer,
      })
      .eq("id", user.id)
      .is("signup_source", null);

    if (error) {
      console.error("[attribution] update failed:", error.message);
      return Response.json({ error: "update_failed" }, { status: 500 });
    }
    return Response.json({ ok: true, source });
  } catch (e) {
    console.error("[attribution] unexpected:", e);
    return Response.json({ error: "unexpected" }, { status: 500 });
  }
}
