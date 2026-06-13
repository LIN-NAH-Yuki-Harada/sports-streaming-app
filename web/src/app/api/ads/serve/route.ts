import { getAdminClient } from "@/lib/supabase-admin";
import { isAdsEnabled } from "@/lib/ads-flag";

export const runtime = "nodejs";

type Campaign = {
  id: string;
  sponsor_name: string;
  target_sports: string[] | null;
  placements: string[] | null;
  weight: number | null;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
};

// 広告配信。コンテキスト（competition=sport / 枠=placement）でマッチする有効キャンペーンを
// 加重ランダムで1つ返す。PII は受け取らない（query は placement と sport のみ）。
// フラグOFF時・在庫なし時は {ad:null}（呼び出し側はフォールバック）。
export async function GET(request: Request) {
  if (!isAdsEnabled()) return Response.json({ ad: null });

  const url = new URL(request.url);
  const placement = url.searchParams.get("placement") ?? "";
  const sport = url.searchParams.get("sport") ?? "";

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("ad_campaigns")
    .select(
      "id, sponsor_name, target_sports, placements, weight, label, starts_at, ends_at",
    )
    .eq("active", true);

  const campaigns = (data ?? []) as Campaign[];
  const eligible = campaigns.filter((c) => {
    if (c.starts_at && c.starts_at > nowIso) return false; // 開始前
    if (c.ends_at && c.ends_at < nowIso) return false; // 終了済（null は無期限）
    const sports = c.target_sports ?? [];
    if (sports.length > 0 && sport && !sports.includes(sport)) return false;
    const places = c.placements ?? [];
    if (places.length > 0 && placement && !places.includes(placement)) return false;
    return true;
  });
  if (eligible.length === 0) return Response.json({ ad: null });

  // 加重ランダム選択
  const weightOf = (c: Campaign) => Math.max(1, c.weight ?? 1);
  const total = eligible.reduce((s, c) => s + weightOf(c), 0);
  let r = Math.random() * total;
  let chosen = eligible[0];
  for (const c of eligible) {
    r -= weightOf(c);
    if (r <= 0) {
      chosen = c;
      break;
    }
  }

  const { data: creatives } = await admin
    .from("ad_creatives")
    .select("media_type, media_url, duration_seconds")
    .eq("campaign_id", chosen.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cr = creatives?.[0] as
    | { media_type: string; media_url: string; duration_seconds: number | null }
    | undefined;
  if (!cr) return Response.json({ ad: null });

  return Response.json({
    ad: {
      campaignId: chosen.id,
      sponsorName: chosen.sponsor_name,
      mediaType: cr.media_type,
      mediaUrl: cr.media_url,
      durationSeconds: cr.duration_seconds,
      label: chosen.label,
    },
  });
}
