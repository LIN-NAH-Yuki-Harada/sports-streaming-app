-- ============================================
-- トライアル管理 マイグレーション
-- ============================================

-- profiles テーブルにトライアル使用フラグを追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_used boolean DEFAULT false;
