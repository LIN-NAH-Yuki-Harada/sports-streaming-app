import { getAdminClient } from "@/lib/supabase-admin";

/**
 * LiveKit Egress が録画 MP4 を書き込む Supabase Storage バケット名。
 * Sprint A1 で作成済 (supabase-migration-egress-grants.sql 参照)。
 */
const STORAGE_BUCKET = "recordings";

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
