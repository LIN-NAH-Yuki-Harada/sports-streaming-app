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

type PlanKey = "team" | "broadcaster" | "free";

const GROUPS: { key: PlanKey; label: string; price: string; accent: string }[] = [
  { key: "team", label: "チームプラン", price: "¥500/月", accent: "text-[#ffb3bb]" },
  { key: "broadcaster", label: "配信者プラン", price: "¥300/月", accent: "text-amber-200" },
  { key: "free", label: "無料", price: "視聴のみ", accent: "text-gray-400" },
];

function planOf(p: string | null): PlanKey {
  if (p === "team") return "team";
  if (p === "broadcaster") return "broadcaster";
  return "free";
}

/**
 * 有料プランが付いているのに課金されていない人を見分ける。
 * ★`plan` はオーナーが手動で team を付けることがあり、**課金の有無と一致しない**。
 *   ここを混ぜて数えると「売上が立っている人数」を読み違える（PL タブと同じ判定）。
 */
function isPaying(r: Row): boolean {
  return r.subscription_status === "active";
}

export default async function AdminUsers() {
  const admin = getAdminClient();
  const { data } = await admin
    .from("profiles")
    .select(
      "id, display_name, plan, subscription_status, trial_used, youtube_channel_name, youtube_live_enabled, is_platform_admin, created_at",
    )
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  const rows = (data ?? []) as Row[];

  const grouped: Record<PlanKey, Row[]> = { team: [], broadcaster: [], free: [] };
  for (const r of rows) grouped[planOf(r.plan)].push(r);

  const paidTotal = grouped.team.length + grouped.broadcaster.length;
  const payingTotal = [...grouped.team, ...grouped.broadcaster].filter(isPaying).length;
  const grantedTotal = paidTotal - payingTotal;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">ユーザー</h1>
        <p className="mt-1 text-xs text-gray-400">
          全 {rows.length}名 ／ 有料プラン {paidTotal}名（
          <span className="text-emerald-300">課金中 {payingTotal}</span>
          {grantedTotal > 0 ? (
            <>
              {" "}
              ・<span className="text-amber-400">手動付与 {grantedTotal}</span>
            </>
          ) : null}
          ） ／ 無料 {grouped.free.length}名
        </p>
      </header>

      {GROUPS.map((g) => {
        const list = grouped[g.key];
        const paying = list.filter(isPaying).length;
        const granted = g.key === "free" ? 0 : list.length - paying;
        return (
          <section key={g.key}>
            <div className="mb-2 flex items-baseline gap-2 border-b border-white/10 pb-1.5">
              <h2 className={`text-sm font-bold ${g.accent}`}>{g.label}</h2>
              <span className="text-[11px] text-gray-500">{g.price}</span>
              <span className="ml-auto text-xs tabular-nums text-gray-400">
                {list.length}名
                {granted > 0 ? (
                  <span className="ml-2 text-amber-400">（うち手動付与 {granted}）</span>
                ) : null}
              </span>
            </div>

            {list.length === 0 ? (
              <p className="px-1 py-2 text-xs text-gray-600">該当する会員はいません。</p>
            ) : (
              <div className="space-y-1.5">
                {list.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <span className="text-sm font-medium">
                      {r.display_name || (
                        <span className="text-gray-600">（名前未設定）</span>
                      )}
                    </span>

                    {/* ★有料プランのときだけ「課金中／手動付与」を出す。
                        無料には課金の概念が無いので出さない（意味のないバッジを増やさない）。 */}
                    {g.key !== "free" ? (
                      isPaying(r) ? (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          課金中
                        </span>
                      ) : (
                        <span
                          className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300"
                          title="有料プランが付いていますが、課金は発生していません（手動付与など）"
                        >
                          手動付与{r.subscription_status ? `・${r.subscription_status}` : ""}
                        </span>
                      )
                    ) : null}

                    {r.youtube_channel_name && (
                      <span className="rounded bg-red-600/20 px-1.5 py-0.5 text-[10px] text-red-200">
                        YT: {r.youtube_channel_name}
                        {r.youtube_live_enabled ? " ✓Live" : ""}
                      </span>
                    )}

                    {/* ★チームプランなのに YouTube 未連携＝録画が1本も残らない状態。
                        大会で実際に12時間分が失われた原因なので、一覧で気づけるようにする。 */}
                    {g.key === "team" && !r.youtube_channel_name && (
                      <span
                        className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400"
                        title="YouTube 未連携のため、試合の録画が保存されません"
                      >
                        YT未連携
                      </span>
                    )}

                    {r.is_platform_admin && (
                      <span className="rounded bg-[#e63946] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        管理者
                      </span>
                    )}

                    <span className="ml-auto text-[10px] tabular-nums text-gray-600">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleDateString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
