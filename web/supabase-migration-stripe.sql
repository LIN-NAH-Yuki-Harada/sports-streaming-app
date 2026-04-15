-- ============================================
-- Stripe連携のためのカラム追加（2026-04-14）
-- Supabase の SQL Editor で実行してください
-- ============================================

-- profiles テーブルに Stripe 関連カラムを追加
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz;

-- Stripe Customer ID で検索するためのインデックス
create index if not exists idx_profiles_stripe_customer
  on public.profiles (stripe_customer_id);

-- Service Role のみが Stripe 関連カラムを更新できるようにする
-- （Webhookハンドラからの更新用。RLSを通常のユーザーに制限）
-- ※ 既存の update ポリシーはそのまま使うが、
--   Webhookからは SUPABASE_SERVICE_ROLE_KEY を使ってRLSをバイパスする
