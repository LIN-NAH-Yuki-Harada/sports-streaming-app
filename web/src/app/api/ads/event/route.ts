import { getAdminClient } from "@/lib/supabase-admin";
import { isAdsEnabled } from "@/lib/ads-flag";

export const runtime = "nodejs";

// インプレッション計測。PII を一切受け取らない・保存しない（campaignId と placement のみ）。
// 子どもコンテンツの広告コンプラ上、視聴者の識別子は持たない設計。
export async function POST(request: Request) {
  if (!isAdsEnabled()) return Response.json({ ok: true });

  let body: { campaignId?: string; placement?: string } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;
  if (!campaignId) return Response.json({ ok: false }, { status: 400 });
  const placement =
    typeof body.placement === "string" ? body.placement.slice(0, 40) : null;

  const admin = getAdminClient();
  await admin
    .from("ad_impressions")
    .insert({ campaign_id: campaignId, placement });

  return Response.json({ ok: true });
}
