"use client";

import { useState } from "react";

export type Bucket = {
  key: string;
  free: number; broadcaster: number; team: number; total: number;
  cumFree: number; cumBroadcaster: number; cumTeam: number; cumTotal: number;
  broadcasts: number; teams: number;
};
export type Kpi = {
  totalMembers: number; free: number; broadcaster: number; team: number;
  teamsTotal: number; broadcastsTotal: number;
  newToday: number; new7: number; newThisMonth: number;
};

type Series = { label: string; color: string; get: (b: Bucket) => number };

const PLAN_SERIES: Series[] = [
  { label: "無料", color: "#9ca3af", get: (b) => b.free },
  { label: "配信者", color: "#3b82f6", get: (b) => b.broadcaster },
  { label: "チーム", color: "#e63946", get: (b) => b.team },
];
const BROADCAST_SERIES: Series[] = [
  { label: "配信", color: "#22c55e", get: (b) => b.broadcasts },
];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (p * m >= v) return p * m;
  return p * 10;
}
const labelEvery = (n: number) => Math.max(1, Math.ceil(n / 12));

function StackedBars({
  data, series, labelOf,
}: { data: Bucket[]; series: Series[]; labelOf: (k: string) => string }) {
  const W = 760, H = 230, padL = 30, padR = 8, padT = 8, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = niceMax(Math.max(1, ...data.map((b) => series.reduce((s, se) => s + se.get(b), 0))));
  const bw = iw / Math.max(1, data.length);
  const step = labelEvery(data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {[0, 0.5, 1].map((f) => {
        const y = padT + ih * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#ffffff14" />
            <text x={2} y={y + 3} fill="#6b7280" fontSize="9">{Math.round(max * f)}</text>
          </g>
        );
      })}
      {data.map((b, i) => {
        const x = padL + i * bw;
        let yTop = padT + ih;
        return (
          <g key={b.key}>
            {series.map((se) => {
              const v = se.get(b);
              const h = (v / max) * ih;
              yTop -= h;
              return v > 0 ? (
                <rect key={se.label} x={x + bw * 0.12} y={yTop} width={Math.max(0.5, bw * 0.76)} height={h} fill={se.color}>
                  <title>{`${b.key} / ${se.label}: ${v}`}</title>
                </rect>
              ) : null;
            })}
            {i % step === 0 ? (
              <text x={x + bw / 2} y={H - 8} fill="#6b7280" fontSize="8" textAnchor="middle">{labelOf(b.key)}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function CumulativeLine({ data, labelOf }: { data: Bucket[]; labelOf: (k: string) => string }) {
  const W = 760, H = 230, padL = 30, padR = 8, padT = 8, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = data.length;
  const max = niceMax(Math.max(1, ...data.map((b) => b.cumTotal)));
  const x = (i: number) => padL + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v: number) => padT + ih * (1 - v / max);
  const pts = data.map((b, i) => [x(i), y(b.cumTotal)] as const);
  const polyline = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const area = n > 0
    ? `M ${pts[0][0]},${padT + ih} ` + pts.map((p) => `L ${p[0]},${p[1]}`).join(" ") + ` L ${pts[n - 1][0]},${padT + ih} Z`
    : "";
  const step = labelEvery(n);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {[0, 0.5, 1].map((f) => {
        const yy = padT + ih * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#ffffff14" />
            <text x={2} y={yy + 3} fill="#6b7280" fontSize="9">{Math.round(max * f)}</text>
          </g>
        );
      })}
      {area ? <path d={area} fill="#e6394622" /> : null}
      <polyline points={polyline} fill="none" stroke="#e63946" strokeWidth="2" />
      {pts.map((p, i) => (
        <circle key={data[i].key} cx={p[0]} cy={p[1]} r="2" fill="#e63946">
          <title>{`${data[i].key}: 累計 ${data[i].cumTotal}名`}</title>
        </circle>
      ))}
      {data.map((b, i) => i % step === 0 ? (
        <text key={b.key} x={x(i)} y={H - 8} fill="#6b7280" fontSize="8" textAnchor="middle">{labelOf(b.key)}</text>
      ) : null)}
    </svg>
  );
}

function Card({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-[#e63946]/40 bg-[#e63946]/10" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-3xl font-black tabular-nums mt-1">{value}</div>
      {sub ? <div className="text-[11px] text-gray-500 mt-1">{sub}</div> : null}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex gap-3 flex-wrap text-xs text-gray-300 mt-2">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-bold text-gray-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function GrowthCharts({ daily, monthly, kpi }: { daily: Bucket[]; monthly: Bucket[]; kpi: Kpi }) {
  const [g, setG] = useState<"day" | "month">("day");
  const data = g === "day" ? daily : monthly;
  const labelOf = (k: string) => (g === "day" ? k.slice(5) : k);

  return (
    <div className="space-y-5">
      {/* KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="会員総数" value={kpi.totalMembers} sub={`無料 ${kpi.free} / 配信者 ${kpi.broadcaster} / チーム ${kpi.team}`} accent />
        <Card label="今月の新規登録" value={`+${kpi.newThisMonth}`} sub={`直近7日 +${kpi.new7} / 本日 +${kpi.newToday}`} />
        <Card label="チーム数" value={kpi.teamsTotal} />
        <Card label="累計配信" value={kpi.broadcastsTotal} />
      </div>

      {/* 日次 / 月次 トグル */}
      <div className="inline-flex rounded-lg border border-white/15 overflow-hidden text-sm">
        {(["day", "month"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setG(opt)}
            className={`px-4 py-1.5 transition ${g === opt ? "bg-[#e63946] text-white" : "text-gray-300 hover:bg-white/10"}`}
          >
            {opt === "day" ? "日次" : "月次"}
          </button>
        ))}
      </div>

      <Panel title="累計会員数の推移">
        <CumulativeLine data={data} labelOf={labelOf} />
      </Panel>

      <Panel title="新規登録（プラン別）">
        <StackedBars data={data} series={PLAN_SERIES} labelOf={labelOf} />
        <Legend series={PLAN_SERIES} />
      </Panel>

      <Panel title="配信数の推移">
        <StackedBars data={data} series={BROADCAST_SERIES} labelOf={labelOf} />
      </Panel>

      {data.length === 0 ? (
        <p className="text-sm text-gray-500">まだデータがありません。</p>
      ) : null}
    </div>
  );
}
