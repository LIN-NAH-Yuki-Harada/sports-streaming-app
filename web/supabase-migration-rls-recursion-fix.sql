-- ============================================
-- RLS 再帰問題の修正
-- 2026-04-25
--
-- 問題:
--   team_members の SELECT ポリシーが自テーブルをサブクエリ参照しており、
--   さらに team_schedules の各ポリシーも team_members をサブクエリ参照していた。
--   PostgreSQL の RLS 評価で再帰が発生し、anon クライアントから team_schedules
--   を SELECT しても常に 0 件になっていた（INSERT は service_role でバイパス
--   されるため成功してしまい、「保存はできるが一覧に出ない」症状になっていた）。
--
-- 修正:
--   SECURITY DEFINER 関数 is_team_member / is_team_admin を導入し、
--   ポリシー内のサブクエリを関数呼び出しに置き換えて再帰を断つ。
--
-- ロールバック:
--   このファイル末尾のロールバック SQL を実行する。
-- ============================================

-- ----------------------------------------
-- 1. ヘルパー関数（SECURITY DEFINER で RLS をバイパスして team_members を読む）
-- ----------------------------------------

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_admin(uuid) to authenticated;

-- ----------------------------------------
-- 2. team_members ポリシーの差し替え
-- ----------------------------------------

drop policy if exists "チームメンバーが一覧を閲覧可能" on public.team_members;
create policy "チームメンバーが一覧を閲覧可能"
  on public.team_members for select
  using (
    user_id = auth.uid()
    or public.is_team_member(team_id)
  );

drop policy if exists "オーナーまたは管理者がメンバーを更新可能" on public.team_members;
create policy "オーナーまたは管理者がメンバーを更新可能"
  on public.team_members for update
  using (public.is_team_admin(team_id));

drop policy if exists "オーナー・管理者がメンバー削除可能または自己脱退" on public.team_members;
create policy "オーナー・管理者がメンバー削除可能または自己脱退"
  on public.team_members for delete
  using (
    user_id = auth.uid()
    or public.is_team_admin(team_id)
  );

-- ----------------------------------------
-- 3. team_schedules ポリシーの差し替え
-- ----------------------------------------

drop policy if exists "チームメンバーが予定を閲覧可能" on public.team_schedules;
create policy "チームメンバーが予定を閲覧可能"
  on public.team_schedules for select
  using (public.is_team_member(team_id));

drop policy if exists "オーナー・管理者が予定を作成可能" on public.team_schedules;
create policy "オーナー・管理者が予定を作成可能"
  on public.team_schedules for insert
  with check (
    created_by = auth.uid()
    and public.is_team_admin(team_id)
  );

drop policy if exists "オーナー・管理者が予定を更新可能" on public.team_schedules;
create policy "オーナー・管理者が予定を更新可能"
  on public.team_schedules for update
  using (public.is_team_admin(team_id));

drop policy if exists "オーナー・管理者が予定を削除可能" on public.team_schedules;
create policy "オーナー・管理者が予定を削除可能"
  on public.team_schedules for delete
  using (public.is_team_admin(team_id));

-- ============================================
-- ロールバック手順（必要時のみ実行）
-- ============================================
-- drop policy if exists "チームメンバーが一覧を閲覧可能" on public.team_members;
-- drop policy if exists "オーナーまたは管理者がメンバーを更新可能" on public.team_members;
-- drop policy if exists "オーナー・管理者がメンバー削除可能または自己脱退" on public.team_members;
-- drop policy if exists "チームメンバーが予定を閲覧可能" on public.team_schedules;
-- drop policy if exists "オーナー・管理者が予定を作成可能" on public.team_schedules;
-- drop policy if exists "オーナー・管理者が予定を更新可能" on public.team_schedules;
-- drop policy if exists "オーナー・管理者が予定を削除可能" on public.team_schedules;
-- drop function if exists public.is_team_member(uuid);
-- drop function if exists public.is_team_admin(uuid);
-- 再度 supabase-migration-teams.sql / supabase-migration-schedules.sql の元ポリシーを実行する
