-- broadcasts.youtube_upload_status に 'cancelled' を追加
-- PR #73 (案A・「YouTube に保存しない」) の migration 漏れ修正
-- 2026-04-29 E2E で発覚: 「設定の更新に失敗しました」エラーの根本原因

ALTER TABLE broadcasts
  DROP CONSTRAINT broadcasts_youtube_upload_status_check;

ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_youtube_upload_status_check
  CHECK (youtube_upload_status = ANY (ARRAY[
    'pending'::text,
    'recording'::text,
    'uploading'::text,
    'completed'::text,
    'failed'::text,
    'cancelled'::text
  ]));
