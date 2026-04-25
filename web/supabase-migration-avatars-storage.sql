-- ============================================
-- マイページのプロフィールアイコン (avatar) アップロード機能
-- 2026-04-25 追加
-- ============================================
-- Supabase Storage の `avatars` バケットを作成し、
-- ユーザーごとに自分のフォルダに upload/update/delete できるよう RLS を設定する。
-- ファイルパス規則: avatars/<user_id>/<timestamp>.jpg
-- ============================================

-- 1. パブリックバケット作成（既に存在すれば NoOp）
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 2. RLS ポリシー（既存ポリシーがあれば事前に DROP してから再作成）

-- 全員: avatars バケットの中身を閲覧可能
drop policy if exists "Avatar files are publicly readable" on storage.objects;
create policy "Avatar files are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- ユーザー自身: 自分のフォルダにアップロード可能
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ユーザー自身: 自分のファイルを更新可能
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ユーザー自身: 自分のファイルを削除可能
drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
