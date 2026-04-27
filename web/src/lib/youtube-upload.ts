import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getAdminClient } from "@/lib/supabase-admin";

/**
 * LiveKit Egress が録画 MP4 を書き込む Supabase Storage バケット名。
 * Sprint A1 で作成済 (supabase-migration-egress-grants.sql 参照)。
 */
const STORAGE_BUCKET = "recordings";

/**
 * profiles テーブルの YouTube 連携カラムから必要な部分を抜き出した型。
 * service_role 経由で取得した値を渡すため、列レベル GRANT 制約は無関係。
 */
export interface YoutubeProfile {
  id: string;
  youtube_access_token: string | null;
  youtube_refresh_token: string | null;
}

/**
 * Supabase Storage から MP4 録画ファイルをダウンロードして Buffer に変換する。
 *
 * `recording_key` は LiveKit Egress webhook (Sprint A3) が保存した
 * `EgressInfo.fileResults[0].filename` をそのまま使う想定。
 * 形式: `{share_code}/{broadcast_id}-{ISO_time}.mp4`
 *
 * 1 分配信なら 30 MB 想定なので一括メモリ load で問題ない (Fluid Compute は
 * 1 GB メモリ枠)。5 分超の長時間配信が常用化したらストリーミング化を検討する。
 *
 * @throws ダウンロード失敗時 (Storage がオブジェクトを返さない / ネットワーク
 *   エラー等) は例外を投げる。呼び出し側で classifyError して retry / failed を
 *   判定する。
 */
export async function downloadRecording(recordingKey: string): Promise<Buffer> {
  const admin = getAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(recordingKey);
  if (error || !data) {
    throw new Error(
      `Storage download failed for ${recordingKey}: ${error?.message ?? "no data"}`,
    );
  }
  // data は Blob。arrayBuffer() で ArrayBuffer 取得 → Node.js Buffer に変換。
  // googleapis の videos.insert に渡す Readable.from() は Buffer も受け付ける。
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * profiles に保存された YouTube アクセストークンから OAuth2Client を準備する。
 * access_token は約 1 時間で失効するため、必要なら refresh_token で更新する。
 *
 * googleapis の OAuth2Client は getAccessToken() を呼ぶと内部で期限を判定して
 * 自動 refresh する。新トークンが取れた場合は profiles.youtube_access_token に
 * 書き戻して、次回呼び出し時のレイテンシ削減 + refresh の頻度低下を図る。
 *
 * @throws refresh_token が無い / refresh が失敗した (token revoked 等) 場合
 *   呼び出し側で classifyError して 'token_revoked' / 'auth-refresh' に分岐
 */
export async function getOAuthClientForProfile(
  profile: YoutubeProfile,
): Promise<OAuth2Client> {
  if (!profile.youtube_refresh_token) {
    throw new Error("youtube_refresh_token missing: re-link required");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: profile.youtube_access_token ?? undefined,
    refresh_token: profile.youtube_refresh_token,
  });

  // 期限切れなら自動 refresh される
  const { token } = await oauth2Client.getAccessToken();

  // refresh された (= 新トークンが返ってきた) なら DB に書き戻し
  if (token && token !== profile.youtube_access_token) {
    const admin = getAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ youtube_access_token: token })
      .eq("id", profile.id);
    if (error) {
      console.warn(
        "[youtube-upload] access_token write-back failed:",
        error.message,
      );
      // 書き戻し失敗してもアップロード自体は続行可能 (oauth2Client にはセット済み)
    }
  }

  return oauth2Client;
}

/**
 * 成功時に Storage から MP4 を削除する。YouTube unlisted が真の正本になり、
 * Storage に残し続けるとコストが累積するため (≈ 月 $0.11 / GB)。
 *
 * 削除は best-effort。失敗してもアップロード自体は完了扱いで OK
 * (cleanup cron が後で拾う or 手動削除でリカバリ可能)。
 */
export async function deleteRecording(recordingKey: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.storage
    .from(STORAGE_BUCKET)
    .remove([recordingKey]);
  if (error) {
    console.warn(
      `[youtube-upload] storage delete failed for ${recordingKey}:`,
      error.message,
    );
  }
}
