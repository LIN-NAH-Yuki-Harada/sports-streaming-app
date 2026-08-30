-- 一斉送信メール（email_campaigns）
--
-- 目的:
--   管理画面から、配信者や課金者にまとめてお知らせを送れるようにする。
--   これまで「1つのきっかけで1人に1通」しか送れず、全員への連絡手段が無かった。
--
-- ★なぜテーブルが必要か（送りっぱなしにしない）
--   1. **テスト送信を必須にする鍵**。テスト送信で行を作り、その行にしか本送信できない
--      仕組みにすることで、「いきなり全員に飛ぶ」事故を構造的に防ぐ。
--   2. **二重送信の防止**。sent_at が入っている行は二度と送れない。
--   3. **誰に届いて誰に失敗したかの記録**。Apple の非公開メール(privaterelay)は
--      送信元ドメインの登録が無いと**エラーも返さず黙って捨てられる**実績があるため、
--      「送った」ではなく「Resend が受け付けた」までを必ず残す。
--
-- ★このテーブルは管理者しか触らない。
--   API は service_role で読み書きするので、anon/authenticated には一切権限を与えない。
--   （RLS を有効にしたうえで**ポリシーを1つも作らない** = 誰も読めない、が正しい状態）

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  -- 件名と本文（本文はプレーンテキスト。表示時に改行を <br> に変換する）
  subject text not null,
  body text not null,
  -- 送信対象の種別。'broadcasters' = 配信したことがある人 / 'paying' = 課金中 / 'all' = 全員
  audience text not null,
  -- 本送信の時点で確定した宛先数・成功数・失敗数
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  -- 宛先ごとの結果 [{ "email": "...", "ok": true }, ...]
  results jsonb,
  -- テスト送信した時刻。★ここが null の行は本送信できない（安全装置の要）
  test_sent_at timestamptz,
  -- 本送信した時刻。★ここが入っている行は二度と送れない（二重送信の防止）
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_campaigns_created_at_idx
  on public.email_campaigns (created_at desc);

alter table public.email_campaigns enable row level security;

-- ★ポリシーを作らない = anon/authenticated からは読み書きできない。
--   service_role は RLS を迂回するので、管理APIからのみ操作できる。
revoke all on public.email_campaigns from anon, authenticated;

-- 検証: 一般ロールに権限が残っていないことを機械的に確認する
do $$
begin
  if has_table_privilege('anon', 'public.email_campaigns', 'SELECT') then
    raise exception 'email_campaigns is readable by anon — revoke failed';
  end if;
  if has_table_privilege('authenticated', 'public.email_campaigns', 'SELECT') then
    raise exception 'email_campaigns is readable by authenticated — revoke failed';
  end if;
end $$;
