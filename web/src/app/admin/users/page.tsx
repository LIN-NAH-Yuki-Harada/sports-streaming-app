import { getAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  display_name: string | null;
  plan: string | null;
  subscription_status: string | null;
  trial_used: boolean | null;
  youtube_channel_name: string | null;
  youtube_live_enabled: boolean | null;
  is_platform_admin: boolean | null;
  created_at: string | null;
};

const PLAN_LABEL: Record<string, string> = {
  team: "チーム ¥500",
  broadcaster: "配信者 ¥300",
  free: "無料",
};

function planClass(plan: string | null): string {
  if (plan === "team") return "bg-[#e63946]/25 text-[#ffb3bb]";
  if (plan === "broadcaster") return "bg-amber-500/25 text-amber-200";
  return "bg-white/10 text-gray-400";
}

export default async function AdminUsers() {
  const admin = getAdminClient();
  const { data } = await admin
    .from("profiles")
    .select(
      "id, display_name, plan, subscription_status, trial_used, youtube_channel_name, youtube_live_enabled, is_platform_admin, created_at",
    )
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(150);
  const rows = (data ?? []) as Row[];

  const counts = rows.reduce(
    (acc, r) => {
      const p = r.plan ?? "free";
      acc[p] = (acc[p] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">ユーザー</h1>
      <p className="text-xs text-gray-500 mb-4">
        直近150件。 チーム {counts.team ?? 0} / 配信者 {counts.broadcaster ?? 0} / 無料{" "}
        {counts.free ?? 0}
      </p>

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="text-xs text-gray-500">ユーザーがいません。</p>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 flex items-center gap-2 flex-wrap"
          >
            <span className="text-sm font-medium">
              {r.display_name || <span className="text-gray-600">（名前未設定）</span>}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${planClass(r.plan)}`}>
              {PLAN_LABEL[r.plan ?? "free"] ?? r.plan ?? "無料"}
            </span>
            {r.subscription_status && r.subscription_status !== "active" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400">
                {r.subscription_status}
              </span>
            )}
            {r.youtube_channel_name && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/20 text-red-200">
                YT: {r.youtube_channel_name}
                {r.youtube_live_enabled ? " ✓Live" : ""}
              </span>
            )}
            {r.is_platform_admin && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e63946] text-white font-semibold">
                管理者
              </span>
            )}
            <span className="text-[10px] text-gray-600 ml-auto">
              {r.created_at?.slice(0, 10) ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
