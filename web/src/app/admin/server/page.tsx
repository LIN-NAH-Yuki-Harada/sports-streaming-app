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
        <strong>1台目（配信サーバー）</strong>の直近24時間。5分ごとにサーバー自身が記録します。
      </p>
      {/* ★2026-09-23: 変換を2台目へ移したので、読み方が変わった。
          以前は「ディスクI/Oの張り付き＝ライブと変換の食い合い」が主な見どころだったが、
          1台目はもう変換しない。いま1台目のI/Oを使うのは
          ①録画の書き込み（軽い）②2台目が録画を読む（sshfs・実測12MB/s）の2つ。
          ここが張り付くようなら、2台目の読み込みが配信を圧迫しているサインになる。 */}
      <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-gray-400">
        <span className="text-gray-200 font-bold">読み方</span>
        <br />
        <strong className="text-gray-200">CPU</strong>{" "}
        … 2026-09-23 に映像の変換を2台目へ移したので、ここはもう上がらないはずです。
        高止まりしていたら、1台目で変換が動いていないか確認してください
        （<code>ARCHIVE_PROCESSING_ENABLED</code> が 1 に戻っている等）。
        <br />
        <strong className="text-gray-200">ディスク読み込み</strong>{" "}
        … 2台目が録画を読むと、ここが増えます（実測 12MB/s ≒ 12,000 KB/s）。
        配信中に張り付くようなら、読み込みが配信を圧迫している可能性があります。
        <br />
        <strong className="text-gray-200">ディスク書き込み</strong>{" "}
        … 配信の録画そのもの。配信1本あたり 0.5MB/s 程度が目安です。
        <br />
        <strong className="text-gray-200">ネットワーク上り</strong>{" "}
        … 視聴者への配信（HLS/CDN）と、2台目への録画転送の合計です。
      </div>
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
