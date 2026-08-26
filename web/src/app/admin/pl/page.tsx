import { getAdminClient } from "@/lib/supabase-admin";
import {
  FEE_RATES,
  IAP_SMALL_BUSINESS_CONFIRMED,
  MONTHLY_COSTS,
  PLAN_PRICES,
  USD_JPY,
  confirmedMonthlyCost,
  maxMonthlyCost,
  type PaidPlan,
} from "@/lib/operating-costs";

// PL（損益）ダッシュボード。
// 認可は /admin/layout.tsx の requireAdminPage() に乗るため、ここではガード不要。
//
// ■ この画面が答える問い
//   「毎月いくら入って、いくら出て、あと何人で黒字か」
//
// ■ 数え方の約束（ここを間違えると数字が嘘になる）
//   1. 売上に数えるのは **subscription_status = "active" の人だけ**。
//      profiles.plan は オーナーが手動で team を付けることがあり、**課金の有無とは一致しない**。
//      手動付与の人はコストだけ発生しているので、売上0の別枠として可視化する。
//   2. 手数料は **経路ごとに率が違う**（Stripe 3.6% / ストア 15%）。
//      経路は iap_product_id → アプリ内課金、なければ stripe_subscription_id → Stripe で判定する。
//   3. 経路が判定できない active は「不明」として別に出す。手数料は安全側（高いほう）で引く。
export const dynamic = "force-dynamic";

type Route = "stripe" | "iap" | "unknown";

const ROUTE_LABEL: Record<Route, string> = {
  stripe: "Stripe（Web）",
  iap: "アプリ内課金",
  unknown: "経路不明",
};

const PLAN_LABEL: Record<PaidPlan, string> = {
  broadcaster: "配信者プラン",
  team: "チームプラン",
};

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

/** 経路ごとの手数料率。不明は安全側（高いほう）で見積もる。 */
function feeRateOf(route: Route): number {
  if (route === "stripe") return FEE_RATES.stripe;
  return FEE_RATES.inAppPurchase; // iap / unknown
}

export default async function PlPage() {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("plan, subscription_status, stripe_subscription_id, iap_product_id")
    .in("plan", ["broadcaster", "team"]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-6">
        <p className="text-sm text-red-300">
          課金データを取得できませんでした: {error.message}
        </p>
      </div>
    );
  }

  const rows = data ?? [];

  // ── 売上の集計 ────────────────────────────────────────────────
  type Cell = { count: number; gross: number };
  const matrix = new Map<string, Cell>();
  let grantedCount = 0; // 手動付与（課金なし）

  for (const r of rows) {
    const plan = r.plan as PaidPlan;
    if (r.subscription_status !== "active") {
      grantedCount += 1;
      continue;
    }
    const route: Route = r.iap_product_id
      ? "iap"
      : r.stripe_subscription_id
        ? "stripe"
        : "unknown";
    const key = `${plan}|${route}`;
    const cur = matrix.get(key) ?? { count: 0, gross: 0 };
    cur.count += 1;
    cur.gross += PLAN_PRICES[plan];
    matrix.set(key, cur);
  }

  const breakdown = [...matrix.entries()]
    .map(([key, cell]) => {
      const [plan, route] = key.split("|") as [PaidPlan, Route];
      const fee = cell.gross * feeRateOf(route);
      return { plan, route, ...cell, fee, net: cell.gross - fee };
    })
    .sort((a, b) => b.net - a.net);

  const grossRevenue = breakdown.reduce((s, b) => s + b.gross, 0);
  const totalFee = breakdown.reduce((s, b) => s + b.fee, 0);
  const netRevenue = grossRevenue - totalFee;
  const payingCount = breakdown.reduce((s, b) => s + b.count, 0);

  // ── コスト ────────────────────────────────────────────────────
  const costConfirmed = confirmedMonthlyCost();
  const costMax = maxMonthlyCost();

  // ── 損益 ──────────────────────────────────────────────────────
  const profitConfirmed = netRevenue - costConfirmed;
  const profitMax = netRevenue - costMax;

  // ── 損益分岐点（あと何人で黒字か）──────────────────────────────
  // 「今と同じ構成比で増える」と仮定せず、**プラン単体で埋める場合**の必要人数を出す。
  // どちらのプランを何人取れば届くかが直感的に分かるほうが判断に使える。
  const shortfall = Math.max(0, costConfirmed - netRevenue);
  const needBy = (plan: PaidPlan, route: Route) => {
    const perHead = PLAN_PRICES[plan] * (1 - feeRateOf(route));
    return perHead > 0 ? Math.ceil(shortfall / perHead) : Infinity;
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-bold">PL（損益）</h1>
        <p className="mt-1 text-xs text-gray-400">
          課金中の会員から算出した月次の収支。売上は{" "}
          <code className="rounded bg-white/10 px-1">subscription_status = active</code>{" "}
          の会員のみを数えています。
        </p>
      </header>

      {/* ── サマリー ───────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="月次売上（手数料差引後）"
          value={yen(netRevenue)}
          sub={`総額 ${yen(grossRevenue)} − 手数料 ${yen(totalFee)}`}
          tone="neutral"
        />
        <SummaryCard
          label="月次コスト（確定分）"
          value={yen(costConfirmed)}
          sub={`未確認を含むと最大 ${yen(costMax)}`}
          tone="neutral"
        />
        <SummaryCard
          label="月次損益"
          value={`${profitConfirmed >= 0 ? "+" : "−"}${yen(Math.abs(profitConfirmed))}`}
          sub={`未確認を含むと ${profitMax >= 0 ? "+" : "−"}${yen(Math.abs(profitMax))}`}
          tone={profitConfirmed >= 0 ? "good" : "bad"}
        />
      </section>

      {/* ── 損益分岐点 ─────────────────────────────────────────── */}
      {shortfall > 0 ? (
        <section className="rounded-lg border border-[#e63946]/40 bg-[#e63946]/5 p-5">
          <h2 className="text-sm font-bold text-[#ff8a94]">
            黒字化まで、あと {yen(shortfall)}／月
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            確定コストを基準にした不足額です。単独のプランだけで埋める場合の必要人数：
          </p>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li className="rounded border border-white/10 bg-black/20 px-3 py-2">
              チームプラン（Web決済）を{" "}
              <strong className="text-white">{needBy("team", "stripe")}名</strong>
            </li>
            <li className="rounded border border-white/10 bg-black/20 px-3 py-2">
              チームプラン（アプリ）を{" "}
              <strong className="text-white">{needBy("team", "iap")}名</strong>
            </li>
            <li className="rounded border border-white/10 bg-black/20 px-3 py-2">
              配信者プラン（Web決済）を{" "}
              <strong className="text-white">{needBy("broadcaster", "stripe")}名</strong>
            </li>
            <li className="rounded border border-white/10 bg-black/20 px-3 py-2">
              配信者プラン（アプリ）を{" "}
              <strong className="text-white">{needBy("broadcaster", "iap")}名</strong>
            </li>
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            ※ 同じ1人でも、Web決済なら手数料 3.6%、アプリ経由なら 15% が引かれます。
            手取りの差は月あたり
            {yen(PLAN_PRICES.team * (FEE_RATES.inAppPurchase - FEE_RATES.stripe))}
            （チームプランの場合）です。
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-5">
          <h2 className="text-sm font-bold text-emerald-300">
            黒字です（確定コスト基準で +{yen(profitConfirmed)}／月）
          </h2>
        </section>
      )}

      {/* ── 売上の内訳 ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-bold">売上の内訳（課金中 {payingCount}名）</h2>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left">プラン</th>
                <th className="px-4 py-2 text-left">経路</th>
                <th className="px-4 py-2 text-right">人数</th>
                <th className="px-4 py-2 text-right">単価</th>
                <th className="px-4 py-2 text-right">総額</th>
                <th className="px-4 py-2 text-right">手数料</th>
                <th className="px-4 py-2 text-right">手取り</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {breakdown.map((b) => (
                <tr key={`${b.plan}-${b.route}`} className="border-t border-white/5">
                  <td className="px-4 py-2">{PLAN_LABEL[b.plan]}</td>
                  <td className="px-4 py-2">
                    {ROUTE_LABEL[b.route]}
                    {b.route === "unknown" ? (
                      <span className="ml-1 text-[10px] text-amber-400">要調査</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">{b.count}</td>
                  <td className="px-4 py-2 text-right text-gray-400">
                    {yen(PLAN_PRICES[b.plan])}
                  </td>
                  <td className="px-4 py-2 text-right">{yen(b.gross)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">
                    −{yen(b.fee)}
                    <span className="ml-1 text-[10px]">
                      ({Math.round(feeRateOf(b.route) * 100)}%)
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{yen(b.net)}</td>
                </tr>
              ))}
              <tr className="border-t border-white/20 bg-white/5 font-bold">
                <td className="px-4 py-2" colSpan={2}>
                  合計
                </td>
                <td className="px-4 py-2 text-right">{payingCount}</td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-right">{yen(grossRevenue)}</td>
                <td className="px-4 py-2 text-right">−{yen(totalFee)}</td>
                <td className="px-4 py-2 text-right">{yen(netRevenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {grantedCount > 0 ? (
          <p className="mt-2 text-xs text-amber-400">
            ほかに、有料プランが付いているが課金されていない会員が {grantedCount}名 います
            （手動付与など）。売上には数えていませんが、サーバー費用は同じように発生しています。
          </p>
        ) : null}
      </section>

      {/* ── コストの内訳 ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-bold">コストの内訳（月額換算）</h2>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left">サービス</th>
                <th className="px-4 py-2 text-left">用途</th>
                <th className="px-4 py-2 text-right">表記</th>
                <th className="px-4 py-2 text-right">月額</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {MONTHLY_COSTS.map((c) => (
                <tr key={c.name} className="border-t border-white/5 align-top">
                  <td className="px-4 py-2">
                    {c.name}
                    {!c.confirmed ? (
                      <span className="ml-1 text-[10px] text-amber-400">未確認</span>
                    ) : null}
                    {c.note ? (
                      <p className="mt-0.5 text-[11px] text-gray-500">{c.note}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-gray-400">{c.purpose}</td>
                  <td className="px-4 py-2 text-right text-gray-400">{c.raw}</td>
                  <td
                    className={`px-4 py-2 text-right ${c.confirmed ? "" : "text-amber-400"}`}
                  >
                    {yen(c.monthlyJpy)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-white/20 bg-white/5 font-bold">
                <td className="px-4 py-2" colSpan={3}>
                  確定分の合計
                </td>
                <td className="px-4 py-2 text-right">{yen(costConfirmed)}</td>
              </tr>
              <tr className="border-t border-white/5 text-amber-400">
                <td className="px-4 py-2" colSpan={3}>
                  未確認を含めた合計
                </td>
                <td className="px-4 py-2 text-right">{yen(costMax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 前提と注意 ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5 text-xs leading-relaxed text-gray-400">
        <h2 className="mb-2 text-sm font-bold text-gray-200">この数字の前提</h2>
        <ul className="space-y-1.5">
          <li>
            ・為替は <strong className="text-gray-200">1ドル = {USD_JPY}円</strong> で換算しています。
          </li>
          <li>
            ・手数料は Stripe {Math.round(FEE_RATES.stripe * 1000) / 10}%、
            アプリ内課金 {Math.round(FEE_RATES.inAppPurchase * 100)}% として計算しています。
            {!IAP_SMALL_BUSINESS_CONFIRMED ? (
              <strong className="text-amber-400">
                　★アプリ内課金の {Math.round(FEE_RATES.inAppPurchase * 100)}% は「小規模事業者プログラム」に
                登録済みであることが前提です。未登録の場合は 30% になり、手取りはこの表より少なくなります。要確認。
              </strong>
            ) : null}
          </li>
          <li>
            ・従量課金（LiveKit の超過分、Stripe の決済ごとの固定費など）は含めていません。
            会員数が増えると実際のコストはこの表より増えます。
          </li>
          <li>
            ・年額のもの（Apple Developer など）は 12 で割って月額に均しています。
          </li>
          <li>
            ・金額を直すときは{" "}
            <code className="rounded bg-white/10 px-1">web/src/lib/operating-costs.ts</code>{" "}
            を編集してください。
          </li>
        </ul>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "good" | "bad" | "neutral";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-[#ff8a94]"
        : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[11px] tracking-wider text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${toneCls}`}>{value}</p>
      <p className="mt-1 text-[11px] text-gray-500">{sub}</p>
    </div>
  );
}
