import { requireAdmin } from "@/lib/admin-auth";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];
const PLACEMENTS = ["postroll", "archive_pre", "preroll", "waiting"];

// キャンペーン一覧（管理者のみ）。
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("ad_campaigns")
    .select(
      "id, sponsor_name, active, starts_at, ends_at, target_sports, placements, weight, label, created_at, ad_creatives(id, media_type, media_url, duration_seconds)",
    )
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ campaigns: data ?? [] });
}

// キャンペーン作成（管理者のみ）。任意でクリエイティブ1件を同時登録。
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  let body: {
    sponsorName?: string;
    targetSports?: string[];
    placements?: string[];
    startsAt?: string | null;
    endsAt?: string | null;
    weight?: number;
    label?: string;
    creative?: { mediaType?: string; mediaUrl?: string; durationSeconds?: number };
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const sponsorName = (body.sponsorName ?? "").trim();
  if (!sponsorName) {
    return Response.json({ error: "スポンサー名は必須です" }, { status: 400 });
  }
  const targetSports = (body.targetSports ?? []).filter((s) => SPORTS.includes(s));
  const placements = (body.placements ?? []).filter((p) => PLACEMENTS.includes(p));
  const weight = Math.min(100, Math.max(1, Math.round(body.weight ?? 1)));
  const label = (body.label ?? "PR").trim().slice(0, 20) || "PR";

  const admin = getAdminClient();
  const { data: campaign, error } = await admin
    .from("ad_campaigns")
    .insert({
      sponsor_name: sponsorName,
      target_sports: targetSports,
      placements,
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      weight,
      label,
      active: true,
    })
    .select("id")
    .single();
  if (error || !campaign) {
    return Response.json(
      { error: error?.message ?? "作成に失敗しました" },
      { status: 500 },
    );
  }

  const cr = body.creative;
  if (cr?.mediaUrl) {
    const mediaType = cr.mediaType === "video" ? "video" : "image";
    await admin.from("ad_creatives").insert({
      campaign_id: (campaign as { id: string }).id,
      media_type: mediaType,
      media_url: cr.mediaUrl,
      duration_seconds: cr.durationSeconds ?? null,
    });
  }

  return Response.json({ ok: true, id: (campaign as { id: string }).id });
}
