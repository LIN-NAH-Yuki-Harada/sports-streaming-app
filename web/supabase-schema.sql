-- ============================================
-- LIVE SPOtCH データベーススキーマ
-- ============================================

-- 1. プロフィールテーブル（ユーザー情報）
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  avatar_url text,
  plan text default 'free' check (plan in ('free', 'broadcaster', 'team')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS ポリシー
alter table public.profiles enable row level security;

create policy "誰でもプロフィールを閲覧可能"
  on public.profiles for select using (true);

create policy "自分のプロフィールのみ更新可能"
  on public.profiles for update using (auth.uid() = id);

create policy "自分のプロフィールを作成可能"
  on public.profiles for insert with check (auth.uid() = id);

-- 2. チームテーブル
create table public.teams (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  sport text not null,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now()
);

alter table public.teams enable row level security;

create policy "誰でもチーム情報を閲覧可能"
  on public.teams for select using (true);

create policy "ログインユーザーがチームを作成可能"
  on public.teams for insert with check (auth.uid() = owner_id);

create policy "オーナーのみチームを更新可能"
  on public.teams for update using (auth.uid() = owner_id);

-- 3. 配信テーブル
create table public.broadcasts (
  id uuid default gen_random_uuid() primary key,
  share_code text unique not null,
  broadcaster_id uuid references public.profiles(id) on delete cascade not null,
  team_id uuid references public.teams(id) on delete set null,
  sport text not null,
  home_team text not null,
  away_team text not null,
  tournament text,
  venue text,
  home_score int default 0,
  away_score int default 0,
  home_sets int default 0,
  away_sets int default 0,
  period text default '前半',
  status text default 'live' check (status in ('live', 'ended')),
  started_at timestamptz default now(),
  ended_at timestamptz
);

alter table public.broadcasts enable row level security;

create policy "誰でも配信情報を閲覧可能"
  on public.broadcasts for select using (true);

create policy "ログインユーザーが配信を作成可能"
  on public.broadcasts for insert with check (auth.uid() = broadcaster_id);

create policy "配信者のみ更新可能"
  on public.broadcasts for update using (auth.uid() = broadcaster_id);

-- 4. 新規ユーザー登録時にプロフィールを自動作成するトリガー
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
