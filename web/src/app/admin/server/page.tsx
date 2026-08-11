import { getAdminClient } from "@/lib/supabase-admin";
import ServerCharts, { type MetricRow } from "./ServerCharts";

// サーバー稼働モニタ（VPSワーカーが5分毎に push する server_metrics を表示）。
// 認可は /admin/layout.tsx の requireAdminPage() に乗るためここではガード不要。
export const dynamic = "force-dynamic";

export default async function AdminServerPage() {
  const admin = getAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("server_metrics")
    .select(
      "created_at, cpu_load_pct, mem_used_pct, disk_used_pct, disk_read_kbps, disk_write_kbps, net_rx_kbps, net_tx_kbps, live_paths, archive_queue",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(400);

  const rows = (data ?? []) as MetricRow[];

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">サーバー稼働</h1>
      <p className="text-xs text-gray-500 mb-4">
        配信サーバー（VPS）の直近24時間。5分ごとにサーバー自身が記録します。
        ネットワーク上り・ディスクI/Oの張り付きは「ライブとアーカイブ変換の食い合い」のサインです。
      </p>
      {error ? (
        <p className="text-sm text-red-400">
          読み込みに失敗しました（server_metrics テーブル未作成の可能性）: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">
          まだデータがありません。VPS側で METRICS_ENABLED=1 を設定すると、5分ごとに記録が始まります。
        </p>
      ) : (
        <ServerCharts rows={rows} />
      )}
    </div>
  );
}
