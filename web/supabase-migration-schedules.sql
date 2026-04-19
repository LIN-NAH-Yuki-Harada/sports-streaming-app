-- ============================================
-- チームスケジュール機能 マイグレーション
-- 2-B: team_schedules テーブルと RLS ポリシー
-- ============================================

create table public.team_schedules (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  start_at timestamptz not null,
  sport text not null,
  home_team text not null,
  away_team text not null,
  location text,
  tournament text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index team_schedules_team_start_idx
  on public.team_schedules(team_id, start_at);

alter table public.team_schedules enable row level security;

-- 閲覧: チームメンバー
create policy "チームメンバーが予定を閲覧可能"
  on public.team_schedules for select
  using (
    team_id in (
      select team_id from public.team_members where user_id = auth.uid()
    )
  );

-- 作成: オーナー・管理者
create policy "オーナー・管理者が予定を作成可能"
  on public.team_schedules for insert
  with check (
    created_by = auth.uid()
    and team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- 更新: オーナー・管理者
create policy "オーナー・管理者が予定を更新可能"
  on public.team_schedules for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- 削除: オーナー・管理者
create policy "オーナー・管理者が予定を削除可能"
  on public.team_schedules for delete
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
