-- ============================================
-- ops_heartbeat（cron の生存記録）マイグレーション 2026-08-14
--
-- 目的: 「サイトは開くのに cron だけ黙っている」を検知する。
-- 各 cron は認証を通った直後に自分の名前で last_run_at を upsert する。
-- VPS のウォッチドッグが /api/health 経由で最新値の鮮度を見て発報する。
--
-- 設計上の約束:
-- - 書き込みは cron（service_role）のみ。1行/1cron しか増えない（name が PK）。
-- - 読み取りも service_role のみ。/api/health はサーバー側で読んで真偽値と
--   時刻だけを返す（このテーブルを直接公開はしない）。
-- - RLS 有効 + ポリシーなし + クライアント GRANT なし = anon/authenticated は不可。
--   （alert_log / server_metrics と同じ方針）
-- ============================================

CREATE TABLE IF NOT EXISTS public.ops_heartbeat (
  name text PRIMARY KEY,                        -- 'cron:cleanup' などの識別子
  last_run_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT true,
  detail text                                   -- 直近の実行の短いメモ（診断用・秘密情報は入れない）
);

ALTER TABLE public.ops_heartbeat ENABLE ROW LEVEL SECURITY;

-- ポリシーは作らない = anon / authenticated は行アクセス不可（service_role は RLS 素通し）。
-- テーブルレベル権限も剥がす（列 GRANT 再付与事故の防止）。
REVOKE ALL ON TABLE public.ops_heartbeat FROM anon, authenticated;
