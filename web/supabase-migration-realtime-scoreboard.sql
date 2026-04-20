-- ============================================
-- スコアボード リアルタイム同期修正 マイグレーション
-- 2026-04-20
--
-- 症状:
--   配信者がスコア（特にバレーのセット結果）を更新しても、
--   視聴者側のオーバーレイにリアルタイムで反映されない。
--
-- 原因:
--   1. broadcasts テーブルに set_results カラムが無く、
--      バレーのセット終了時 UPDATE が全体失敗していた
--   2. broadcasts が supabase_realtime publication に登録されておらず、
--      postgres_changes イベントが視聴者に配信されない
--   3. REPLICA IDENTITY が DEFAULT のため、Realtime UPDATE payload が
--      プライマリキーのみで他カラムの変更が取りこぼされる
-- ============================================

-- 1) set_results カラムを追加（既に存在すれば何もしない）
alter table public.broadcasts
  add column if not exists set_results jsonb default '[]'::jsonb;

-- 2) Realtime が UPDATE 時に全カラムの値を配信するよう設定
alter table public.broadcasts replica identity full;

-- 3) broadcasts テーブルを supabase_realtime publication に登録
--    既に登録済みだとエラーになるため DO ブロックで冪等化
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'broadcasts'
  ) then
    alter publication supabase_realtime add table public.broadcasts;
  end if;
end
$$;

-- ============================================
-- 動作確認クエリ（実行後、下記を手動で走らせて確認可能）
-- ============================================
-- 確認A: set_results カラムが存在するか
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'broadcasts'
--      and column_name = 'set_results';
--
-- 確認B: broadcasts が publication に入っているか
--   select * from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename = 'broadcasts';
--
-- 確認C: REPLICA IDENTITY FULL になっているか（f = full）
--   select relname, relreplident
--     from pg_class
--    where relname = 'broadcasts';
