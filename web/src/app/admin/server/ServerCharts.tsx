"use client";

// サーバー稼働モニタのグラフ群（GrowthCharts と同じ素の SVG 流儀・ダークテーマ）。
// 単位: *_kbps はキロビット/秒（NW は Mbps、ディスクは MB/s に換算して表示）。

export type MetricRow = {
  created_at: string;
  cpu_load_pct: number | null;
  mem_used_pct: number | null;
  disk_used_pct: number | null;
  disk_read_kbps: number | null;
  disk_write_kbps: number | null;
  net_rx_kbps: number | null;
  net_tx_kbps: number | null;
  live_paths: number | null;
  archive_queue: number | null;
};

const kbpsToMbps = (v: number | null) => (v == null ? null : v / 1000);
const kbpsToMBs = (v: number | null) => (v == null ? null : v / 8 / 1000);

function fmtJstTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (p * m >= v) return p * m;
  return p * 10;
}

type Series = {
  label: string;
  color: string;
  get: (r: MetricRow) => number | null;
};

function LineChart({
  rows,
  series,
  unit,
  fixedMax,
}: {
  rows: MetricRow[];
  series: Series[];
  unit: string;
  fixedMax?: number;
}) {
  const W = 760,
    H = 180,
    padL = 40,
    padR = 8,
    padT = 8,
    padB = 22;
  const iw = W - padL - padR,
    ih = H - padT - padB;
  const values = rows.flatMap((r) =>
    series.map((s) => s.get(r)).filter((v): v is number => v != null),
  );
  const max = fixedMax ?? niceMax(Math.max(1, ...values));
  const x = (i: number) => padL + (iw * i) / Math.max(1, rows.length - 1);
  const y = (v: number) => padT + ih * (1 - Math.min(1, v / max));
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {[0, 0.5, 1].map((f) => {
        const yy = padT + ih * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#ffffff14" />
            <text x={2} y={yy + 3} fill="#6b7280" fontSize="9">
              {Math.round(max * f * 10) / 10}
              {f === 1 ? unit : ""}
            </text>
          </g>
        );
      })}
      {rows.map((r, i) =>
        i % labelStep === 0 ? (
          <text
            key={r.created_at}
            x={x(i)}
            y={H - 6}
            fill="#6b7280"
            fontSize="9"
            textAnchor="middle"
          >
            {fmtJstTime(r.created_at)}
          </text>
        ) : null,
      )}
      {series.map((s) => {
        const pts = rows
          .map((r, i) => {
            const v = s.get(r);
            return v == null ? null : `${x(i)},${y(v)}`;
          })
          .filter(Boolean)
          .join(" ");
        return (
          <polyline
            key={s.label}
            points={pts}
            fill="none"
            stroke={s.color}
            strokeWidth="1.8"
          />
        );
      })}
    </svg>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex gap-3 text-[10px] text-gray-400 mb-1">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: s.color }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-[#111] border border-white/10 rounded-lg px-3 py-2.5">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`text-lg font-black tabular-nums ${warn ? "text-[#e63946]" : ""}`}>
        {value}
      </p>
    </div>
  );
}

const USAGE_SERIES: Series[] = [
  { label: "CPU", color: "#e63946", get: (r) => r.cpu_load_pct },
  { label: "メモリ", color: "#3b82f6", get: (r) => r.mem_used_pct },
  { label: "ディスク使用率", color: "#9ca3af", get: (r) => r.disk_used_pct },
];
const NET_SERIES: Series[] = [
  { label: "上り(送信)", color: "#e63946", get: (r) => kbpsToMbps(r.net_tx_kbps) },
  { label: "下り(受信)", color: "#3b82f6", get: (r) => kbpsToMbps(r.net_rx_kbps) },
];
const DISK_SERIES: Series[] = [
  { label: "書き込み", color: "#f4a300", get: (r) => kbpsToMBs(r.disk_write_kbps) },
  { label: "読み取り", color: "#22c55e", get: (r) => kbpsToMBs(r.disk_read_kbps) },
];
const LIVE_SERIES: Series[] = [
  { label: "配信中パス数", color: "#e63946", get: (r) => r.live_paths },
  { label: "アーカイブ待ち", color: "#f4a300", get: (r) => r.archive_queue },
];

export default function ServerCharts({ rows }: { rows: MetricRow[] }) {
  const latest = rows[rows.length - 1];
  const fmt = (v: number | null, suffix = "") =>
    v == null ? "—" : `${Math.round(v * 10) / 10}${suffix}`;

  return (
    <div className="space-y-6">
      {/* 最新値タイル */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        <StatTile
          label="CPU"
          value={fmt(latest.cpu_load_pct, "%")}
          warn={(latest.cpu_load_pct ?? 0) >= 80}
        />
        <StatTile
          label="メモリ"
          value={fmt(latest.mem_used_pct, "%")}
          warn={(latest.mem_used_pct ?? 0) >= 85}
        />
        <StatTile
          label="ディスク"
          value={fmt(latest.disk_used_pct, "%")}
          warn={(latest.disk_used_pct ?? 0) >= 70}
        />
        <StatTile
          label="上り帯域"
          value={fmt(kbpsToMbps(latest.net_tx_kbps), " Mbps")}
        />
        <StatTile
          label="配信中"
          value={fmt(latest.live_paths, " 本")}
        />
        <StatTile
          label="アーカイブ待ち"
          value={fmt(latest.archive_queue, " 件")}
          warn={(latest.archive_queue ?? 0) >= 3}
        />
      </div>
      <p className="text-[10px] text-gray-600 -mt-3">
        最終更新: {fmtJstTime(latest.created_at)} JST（5分ごと更新）
      </p>

      <section>
        <h2 className="text-sm font-bold mb-1">使用率（%）</h2>
        <Legend series={USAGE_SERIES} />
        <LineChart rows={rows} series={USAGE_SERIES} unit="%" fixedMax={100} />
      </section>

      <section>
        <h2 className="text-sm font-bold mb-1">ネットワーク帯域（Mbps）</h2>
        <p className="text-[10px] text-gray-600 mb-1">
          上りの張り付き＝視聴帯域の天井。ライブ中にアーカイブのアップロードが重なると跳ねます。
        </p>
        <Legend series={NET_SERIES} />
        <LineChart rows={rows} series={NET_SERIES} unit="Mbps" />
      </section>

      <section>
        <h2 className="text-sm font-bold mb-1">ディスクI/O（MB/s）</h2>
        <p className="text-[10px] text-gray-600 mb-1">
          ライブ中の書き込み張り付き＝変換との食い合い（7/22型）のサイン。
        </p>
        <Legend series={DISK_SERIES} />
        <LineChart rows={rows} series={DISK_SERIES} unit="MB/s" />
      </section>

      <section>
        <h2 className="text-sm font-bold mb-1">配信とアーカイブ滞留</h2>
        <Legend series={LIVE_SERIES} />
        <LineChart rows={rows} series={LIVE_SERIES} unit="" />
      </section>
    </div>
  );
}
