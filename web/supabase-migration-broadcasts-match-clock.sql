-- ============================================
-- broadcasts.match_clock_*（試合タイマー）マイグレーション 2026-08-29
--
-- 少年サッカー保護者・西田様の要望。整列・挨拶から試合後まで撮影するため
-- 「配信の経過時間」と「試合の経過時間」がずれ、**途中から視聴した人が今何分か分からない**。
-- DAZN のようにスコアボードの中へ試合時間を出す（既存の右上の配信経過時間は変更しない）。
--
-- ■ なぜ2列か
-- 毎秒 DB に書くのは論外なので、「動いている区間の開始時刻」と「停止済み区間の累計秒」を
-- 持ち、表示側で計算する。
--
--   表示秒数 = match_clock_offset_seconds
--              + (match_clock_started_at があれば now - match_clock_started_at)
--
--   開始    started_at = now(), offset = 0
--   停止    offset += now - started_at, started_at = null
--   再開    started_at = now()（offset 据え置き）
--   リセット started_at = null, offset = 0
--
-- この4操作だけで両方の運用に対応できる:
--   通し（DAZN式・後半45:00〜）      … 停止 → 再開
--   後半0分から（少年サッカーで一般的）… 停止 → リセット → 開始
--
-- ■ 後方互換
-- 両方が初期値（null / 0）なら**タイマーを表示しない**。既存配信・過去アーカイブ・
-- 他競技（バレー・野球・テニス）は一切影響を受けない。競技での出し分けも不要
-- （使わない配信者は押さないだけ）。
--
-- - 書き込み: 配信者本人のみ（既存 RLS「配信者のみ更新可能」+ 列 GRANT UPDATE）
-- - 読み取り: 視聴ページの公開情報のため anon / authenticated に SELECT GRANT
-- - Realtime: broadcasts は publication 登録済みのため追加設定不要（スコアと同経路）
--
-- 背景: broadcasts はテーブルレベル GRANT を REVOKE し安全列だけ列 GRANT する設計
-- （feedback_pg_column_revoke_trap）。新規カラムは同 migration で列 GRANT 必須。
-- ★過去に set_results が GRANT 漏れで数ヶ月「書けるが読めない死列」になっていた。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS match_clock_started_at timestamptz;

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS match_clock_offset_seconds integer NOT NULL DEFAULT 0;

GRANT SELECT (match_clock_started_at) ON public.broadcasts TO anon, authenticated;
GRANT SELECT (match_clock_offset_seconds) ON public.broadcasts TO anon, authenticated;
GRANT UPDATE (match_clock_started_at) ON public.broadcasts TO authenticated;
GRANT UPDATE (match_clock_offset_seconds) ON public.broadcasts TO authenticated;

-- 検証: GRANT が効いていなければここで失敗させる（死列を機械的に防ぐ）
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'match_clock_started_at', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT SELECT to anon failed for broadcasts.match_clock_started_at';
  END IF;
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'match_clock_offset_seconds', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT SELECT to anon failed for broadcasts.match_clock_offset_seconds';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'match_clock_started_at', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT SELECT to authenticated failed for broadcasts.match_clock_started_at';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'match_clock_offset_seconds', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT SELECT to authenticated failed for broadcasts.match_clock_offset_seconds';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'match_clock_started_at', 'UPDATE') THEN
    RAISE EXCEPTION 'GRANT UPDATE to authenticated failed for broadcasts.match_clock_started_at';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'match_clock_offset_seconds', 'UPDATE') THEN
    RAISE EXCEPTION 'GRANT UPDATE to authenticated failed for broadcasts.match_clock_offset_seconds';
  END IF;
END $$;

-- ============================================
-- 確認クエリ（実行後に目視したい場合）
-- ============================================
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'broadcasts' AND column_name LIKE 'match_clock%';

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- REVOKE SELECT (match_clock_started_at, match_clock_offset_seconds) ON public.broadcasts FROM anon, authenticated;
-- REVOKE UPDATE (match_clock_started_at, match_clock_offset_seconds) ON public.broadcasts FROM authenticated;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS match_clock_started_at;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS match_clock_offset_seconds;
