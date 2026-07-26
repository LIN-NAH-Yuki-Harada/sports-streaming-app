-- ============================================
-- server_metrics（VPS稼働メトリクス）マイグレーション 2026-07-26
-- VPSのアーカイブワーカーが tick(5分)毎に自分の健康状態を push する「押し込み方式」。
-- admin「サーバー」タブがグラフ表示に使う（週1のVPS数字確認の常設化・7/22型の
-- 食い合い再発の可視化・大会日の無料計測の自動化）。
--
-- セキュリティ設計:
-- - 書き込み: VPSワーカー（service_role）のみ
-- - 読み取り: admin ページのサーバーコンポーネント（service_role）のみ
-- - RLS 有効 + ポリシーなし + クライアント向け GRANT なし
--   ＝ anon / authenticated からは一切アクセス不可（内部テレメトリ）
-- ============================================

CREATE TABLE IF NOT EXISTS public.server_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  host text NOT NULL DEFAULT 'vps-main',
  -- 1分ロードアベレージ/コア数 ×100（%相当）
  cpu_load_pct numeric,
  mem_used_pct numeric,
  disk_used_pct numeric,
  -- 前tickとの差分から算出した平均レート（すべて kbps=キロビット/秒。表示側で換算）
  disk_read_kbps numeric,
  disk_write_kbps numeric,
  net_rx_kbps numeric,
  net_tx_kbps numeric,
  -- MediaMTX の配信中(ready)パス数
  live_paths int,
  -- アーカイブ待ち（ended かつ 未処理）件数
  archive_queue int
);

ALTER TABLE public.server_metrics ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_server_metrics_created
  ON public.server_metrics (created_at DESC);
