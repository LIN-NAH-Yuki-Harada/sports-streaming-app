-- 登録経路（どこから来て会員登録したか）を profiles に記録する
--
-- 目的:
--   「SNS・広告・視聴ページ・検索のどれが登録につながったか」が分からないまま
--   広告費を使わないための計測の土台。9/27 時点で、課金者の流入元は1件も分かっていない。
--
-- 書き込み:
--   /api/attribution（service_role）が新規登録の直後に1回だけ書く。
--   ブラウザが初回訪問時に保存した utm_* / 着地ページ / 参照元（web/src/lib/attribution.ts）を使う。
--   アプリ（iOS/Android）で登録した人はここが空のまま＝「アプリ/不明」として扱う。
--
-- signup_source の値:
--   utm_source があればその値（例: youtube / line / instagram / meta）
--   無ければ 着地が /watch/... → 'watch'（誰かの配信を見に来て登録）
--   無ければ 参照元ドメインを丸めた名前（google / yahoo / instagram ...）
--   どれも無ければ 'direct'
--
-- ★権限: 新しい列はクライアント（anon/authenticated）に SELECT を付けない。
--   profiles はテーブル単位の SELECT を revoke 済みで、列ごとに grant している
--   （supabase-schema.sql 参照）ので、ここで grant しなければ自動的に見えない＝他人の登録経路は漏れない。

alter table public.profiles add column if not exists signup_source text;
alter table public.profiles add column if not exists signup_medium text;
alter table public.profiles add column if not exists signup_campaign text;
alter table public.profiles add column if not exists signup_landing text;
alter table public.profiles add column if not exists signup_referrer text;

-- 管理画面・週次レポートで「経路別の登録数」を出すため
create index if not exists profiles_signup_source_idx on public.profiles (signup_source);
