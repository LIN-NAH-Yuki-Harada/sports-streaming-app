-- ============================================
-- チーム管理機能 マイグレーション
-- ============================================

-- 1. teams テーブルに招待コード・説明を追加
alter table public.teams
  add column if not exists invite_code text unique,
  add column if not exists description text,
  add column if not exists updated_at timestamptz default now();

-- 招待コードの初期値を既存行に設定（既存チームがあれば）
update public.teams
set invite_code = upper(substr(md5(random()::text), 1, 8))
where invite_code is null;

-- オーナーのみ削除可能ポリシー
create policy "オーナーのみチームを削除可能"
  on public.teams for delete using (auth.uid() = owner_id);

-- 2. team_members テーブル
create table public.team_members (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz default now(),
  unique(team_id, user_id)
);

alter table public.team_members enable row level security;

-- メンバーは自分のチーム一覧を閲覧可能
create policy "チームメンバーが一覧を閲覧可能"
  on public.team_members for select
  using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members where user_id = auth.uid()
    )
  );

-- ログインユーザーがメンバーとして参加可能（自分自身のみ）
create policy "自分自身をメンバーとして追加可能"
  on public.team_members for insert
  with check (user_id = auth.uid());

-- チームオーナー・管理者がメンバーを更新可能
create policy "オーナーまたは管理者がメンバーを更新可能"
  on public.team_members for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- チームオーナー・管理者がメンバーを削除可能 / 自分自身が脱退可能
create policy "オーナー・管理者がメンバー削除可能または自己脱退"
  on public.team_members for delete
  using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
