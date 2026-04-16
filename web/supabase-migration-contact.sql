-- ============================================
-- お問い合わせテーブル マイグレーション
-- ============================================

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RLS有効化（APIからはService Roleでアクセスするため、一般ユーザーのアクセスはブロック）
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
