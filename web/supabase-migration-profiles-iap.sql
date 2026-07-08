-- ============================================
-- Apple IAP（アプリ内課金 / RevenueCat 経由）: profiles 拡張
-- 2026-06-22
--
-- App Store 審査 3.1.1 対応として、iOS アプリのプラン課金を In-App Purchase 化する。
-- 課金ソースが Web(Stripe) でも iOS(IAP) でも、機能ゲートは全て profiles.plan を
-- 読むだけなので、IAP は「Stripe webhook と同じく profiles.plan を書く」だけで統合できる。
-- plan / subscription_status / current_period_end は Stripe と共有。
--
-- 下記2列は「課金ソースが IAP である」ことの追跡用 内部列（破棄/突合に使用）。
-- クライアント（anon/authenticated）には公開しない＝列レベル GRANT は付与しない
-- （既存の stripe_subscription_id と同じ扱い・service-role の webhook のみ参照）。
--
-- 関連: web/src/app/api/revenuecat/webhook/route.ts
-- ============================================

ALTER TABLE public.profiles
  -- IAP の Store プロダクト ID（どのプランか・例: team_monthly）。
  ADD COLUMN IF NOT EXISTS iap_product_id text,
  -- Apple の original_transaction_id（サブスクの一意キー・突合/重複検知用）。
  ADD COLUMN IF NOT EXISTS iap_original_transaction_id text;
