import { getAdminClient } from "@/lib/supabase-admin";
import GrowthCharts, { type Bucket, type Kpi } from "./GrowthCharts";

// 成長ダッシュボード（service_role で集計・JST日次/月次）。
// 認可は /admin/layout.tsx の requireAdminPage() に乗るため、ここではガード不要。
export const dynamic = "force-dynamic";

type PlanKey = "free" | "broadcaster" | "team";
function planOf(p: string | null): PlanKey {
  if (p === "team") return "team";
  if (p === "broadcaster") return "broadcaster";
  return "free"; // null/不明は無料扱い
}

const pad = (n: number) => String(n).padStart(2, "0");
// created_at(UTC) を JST の壁時計に変換（UTCフィールドがJST暦を表す Date を返す）。
function toJst(iso: string): Date {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
}
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const ym = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

function buildBuckets(
  granularity: "day" | "month",
  members: { plan: PlanKey; d: Date }[],
  broadcasts: Date[],
  teams: Date[],
): Bucket[] {
  const all = [...members.map((m) => m.d), ...broadcasts, ...teams];
  if (all.length === 0) return [];
  const keyOf = granularity === "day" ? ymd : ym;

  const min = new Date(Math.min(...all.map((d) => d.getTime())));
  const max = toJst(new Date().toISOString());

  // 連続した時間軸キーを生成（隙間も0で埋める）
  const keys: string[] = [];
  if (granularity === "day") {
    const cur = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate()));
    const end = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), max.getUTCDate()));
    while (cur <= end) {
      keys.push(ymd(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else {
    const cur = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
    const end = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), 1));
    while (cur <= end) {
      keys.push(ym(cur));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const map = new Map<string, Bucket>();
  for (const k of keys) {
    map.set(k, {
      key: k, free: 0, broadcaster: 0, team: 0, total: 0,
      cumFree: 0, cumBroadcaster: 0, cumTeam: 0, cumTotal: 0,
      broadcasts: 0, teams: 0,
    });
  }
  for (const m of members) {
    const b = map.get(keyOf(m.d));
    if (b) { b[m.plan] += 1; b.total += 1; }
  }
  for (const d of broadcasts) {
    const b = map.get(keyOf(d));
    if (b) b.broadcasts += 1;
  }
  for (const d of teams) {
    const b = map.get(keyOf(d));
    if (b) b.teams += 1;
  }

  let cf = 0, cb = 0, ct = 0;
  return keys.map((k) => {
    const b = map.get(k)!;
    cf += b.free; cb += b.broadcaster; ct += b.team;
    b.cumFree = cf; b.cumBroadcaster = cb; b.cumTeam = ct; b.cumTotal = cf + cb + ct;
    return b;
  });
}

// ★Supabase(PostgREST) は1回の問い合わせで最大1000行しか返さない（サーバー側の max_rows）。
//   `.limit(100000)` を付けてもこの上限は超えられず、黙って1000行で切れる。
//   2026-09-27、累計配信が「1,000」から動かなくなって発覚（実数1,377）。
//   どの1000行が返るかも不定なので、日次グラフも欠けていた。→ 1000行ずつ全ページを取る。
const PAGE = 1000;
async function fetchAllRows<T>(
  table: "profiles" | "broadcasts" | "teams",
  columns: string,
): Promise<T[]> {
  const admin = getAdminClient();
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .order("id", { ascending: true }) // ページ間で重複・欠落しないよう順序を固定
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} の取得に失敗しました: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export default async function AdminGrowthPage() {
  const [profileRows, broadcastRows, teamRows] = await Promise.all([
    fetchAllRows<{ plan: string | null; created_at: string | null }>("profiles", "plan, created_at"),
    fetchAllRows<{ started_at: string | null }>("broadcasts", "started_at"),
    fetchAllRows<{ created_at: string | null }>("teams", "created_at"),
  ]);

  const members = profileRows
    .filter((r): r is { plan: string | null; created_at: string } => !!r.created_at)
    .map((r) => ({ plan: planOf(r.plan), d: toJst(r.created_at) }));
  const broadcasts = broadcastRows
    .map((r) => r.started_at)
    .filter((s): s is string => !!s)
    .map((s) => toJst(s));
  const teams = teamRows
    .map((r) => r.created_at)
    .filter((s): s is string => !!s)
    .map((s) => toJst(s));

  const daily = buildBuckets("day", members, broadcasts, teams);
  const monthly = buildBuckets("month", members, broadcasts, teams);

  // ヘッドラインKPI
  const free = members.filter((m) => m.plan === "free").length;
  const broadcaster = members.filter((m) => m.plan === "broadcaster").length;
  const team = members.filter((m) => m.plan === "team").length;
  const last = daily[daily.length - 1];
  const new7 = daily.slice(-7).reduce((s, b) => s + b.total, 0);
  const newThisMonth = monthly[monthly.length - 1]?.total ?? 0;

  const kpi: Kpi = {
    totalMembers: members.length,
    free, broadcaster, team,
    teamsTotal: teams.length,
    broadcastsTotal: broadcasts.length,
    newToday: last?.total ?? 0,
    new7,
    newThisMonth,
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">成長ダッシュボード</h1>
      <p className="text-xs text-gray-500 mb-4">
        会員登録・配信・チームの推移（JST集計）。プラン内訳は現在のプランで色分け（過去の昇格は登録日側に反映）。
      </p>
      <GrowthCharts daily={daily} monthly={monthly} kpi={kpi} />
    </div>
  );
}
