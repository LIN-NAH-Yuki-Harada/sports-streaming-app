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
  description text,
  invite_code text unique,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.teams enable row level security;

create policy "誰でもチーム情報を閲覧可能"
  on public.teams for select using (true);

create policy "ログインユーザーがチームを作成可能"
  on public.teams for insert with check (auth.uid() = owner_id);

create policy "オーナーのみチームを更新可能"
  on public.teams for update using (auth.uid() = owner_id);

create policy "オーナーのみチームを削除可能"
  on public.teams for delete using (auth.uid() = owner_id);

-- 2.5 チームメンバーテーブル
create table public.team_members (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references public.teams(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz default now(),
  unique(team_id, user_id)
);

alter table public.team_members enable row level security;

create policy "チームメンバーが一覧を閲覧可能"
  on public.team_members for select
  using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "自分自身をメンバーとして追加可能"
  on public.team_members for insert
  with check (user_id = auth.uid());

create policy "オーナーまたは管理者がメンバーを更新可能"
  on public.team_members for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "オーナー・管理者がメンバー削除可能または自己脱退"
  on public.team_members for delete
  using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

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

-- 5. プロモコード（無料トライアル配布用、営業配布向け）
-- 詳細は supabase-migration-promo-codes.sql を参照
create table public.promo_codes (
  code text primary key,
  trial_days integer not null check (trial_days between 1 and 90),
  max_uses integer,
  uses_count integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promo_codes enable row level security;
-- 一般ユーザー・anon にはアクセス権を与えない（Service Role のみが検証・更新できる）
