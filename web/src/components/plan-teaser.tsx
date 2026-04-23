import Link from "next/link";

type Highlight = "broadcaster" | "team";

type Props = {
  /** ページ文脈に合わせた一言。例: "チーム管理はチームプラン ¥500 から" */
  contextLabel?: string;
  /** 強調するプラン。ページ文脈に合わせて選ぶ。 */
  highlight?: Highlight;
};

const PLANS = [
  {
    key: "free" as const,
    title: "無料",
    price: "¥0",
    subtitle: "視聴する人",
    bullets: ["ライブ視聴", "1ヶ月以内のアーカイブ視聴"],
  },
  {
    key: "broadcaster" as const,
    title: "配信者",
    price: "¥300",
    subtitle: "ライブ配信専用",
    bullets: ["無制限ライブ配信", "スコアボード", "LINE共有"],
  },
  {
    key: "team" as const,
    title: "チーム",
    price: "¥500",
    subtitle: "記録・運用向け",
    bullets: ["配信者プランの全機能", "チーム・スケジュール管理", "アーカイブ・YouTube連携"],
  },
];

export function PlanTeaser({ contextLabel, highlight = "broadcaster" }: Props) {
  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-[#111] p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-[#e63946]/15 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-[#e63946]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h14a2 2 0 012 2v4zm0 0v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m18 0h-5a2 2 0 00-2 2" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold">料金プラン</p>
          {contextLabel && (
            <p className="text-[11px] text-gray-500 truncate">{contextLabel}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PLANS.map((plan) => {
          const isHi = plan.key === highlight;
          return (
            <div
              key={plan.key}
              className={`rounded-md p-2 md:p-3 text-center border ${
                isHi
                  ? "bg-[#e63946]/10 border-[#e63946]/40"
                  : "bg-black/30 border-white/5"
              }`}
            >
              <p
                className={`text-[10px] md:text-[11px] font-bold tracking-wider ${
                  isHi ? "text-[#e63946]" : "text-gray-500"
                }`}
              >
                {plan.title.toUpperCase()}
              </p>
              <p className="text-sm md:text-base font-black mt-1">{plan.price}</p>
              <p className="text-[9px] md:text-[10px] text-gray-500 mt-0.5 leading-tight">
                {plan.subtitle}
              </p>
              <ul className="hidden md:block mt-2 space-y-0.5">
                {plan.bullets.map((b) => (
                  <li key={b} className="text-[10px] text-gray-500 leading-tight">
                    ・{b}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg bg-[#e63946]/10 border border-[#e63946]/30 px-3 py-2 flex items-center gap-2">
        <span className="text-base shrink-0" aria-hidden="true">
          🎁
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] md:text-xs text-[#e63946] font-bold leading-tight">
            今ならクーポン <span className="font-mono">SPOT1W</span> で1週間無料
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
            配信者プラン・チームプランどちらもお試し可
          </p>
        </div>
      </div>

      <Link
        href="/pricing?promo=SPOT1W"
        className="mt-3 flex items-center justify-center gap-1 w-full bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold py-2.5 rounded-md transition"
      >
        プランを詳しく見る
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      <p className="mt-2 text-[10px] text-gray-600 text-center">
        視聴のみなら登録だけで OK（無料）
      </p>
    </div>
  );
}
