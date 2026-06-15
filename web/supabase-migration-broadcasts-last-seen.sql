-- ============================================
-- broadcasts.last_seen_at 列追加 migration
-- 2026-06-15
--
-- 目的: ゴースト配信（配信者が止めたのに status='live' が残る）の恒久対策。
-- 配信者クライアントが配信中 60 秒ごとに last_seen_at を更新する「心拍(heartbeat)」を打ち、
-- サーバー側 cron(/api/cron/cleanup) が last_seen の途絶（数分）を見て自動で ended に補正する。
--
-- これにより:
--  1. 異常終了（クラッシュ/スリープ/回線断）で停止処理(pagehide/stop)が飛ばなくても掃除できる。
--  2. 旧来の「開始から2時間で一律終了」だと長い試合を誤終了していた問題を防ぐ
--     （心拍が続く限り生かす。心拍が無い旧/他経路の配信のみ started_at>2h のフォールバックで終了）。
--
-- ※「14時間→数分」に縮める高頻度 cron 化（vercel.json の schedule）は Vercel Pro 前提のため
--   本 migration には含めない（別途オーナー判断）。本列＋cron判定は日次 cron でも安全に機能する。
--
-- 権限設計（feedback_pg_column_revoke_trap）:
--   - last_seen_at は運用カラムでクライアント表示には使わない（誰も SELECT しない）ため SELECT GRANT 不要。
--   - 書き込みは配信者(authenticated)。INSERT/UPDATE はテーブルレベル GRANT が残っているため追加不要。
--   - 読み取りは cron が service_role（RLS / 列 GRANT をバイパス）で行う。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS last_seen_at;
