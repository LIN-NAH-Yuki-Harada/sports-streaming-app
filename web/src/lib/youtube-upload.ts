import { Readable } from "node:stream";
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
 * YouTube アップロード時に動画タイトル / 説明 / タグを組み立てるための
 * 試合メタデータ。broadcasts 行から必要な情報だけ抜粋する。
 */
export interface VideoMetadata {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  tournament: string | null;
  venue: string | null;
  startedAt: string | null;
  shareCode: string;
}

/**
 * MP4 Buffer を配信者の YouTube チャンネルに unlisted でアップロードする。
 *
 * カテゴリは "17" (Sports) 固定。selfDeclaredMadeForKids=false でコメント
 * 制限等を回避（本サービスでは大人 / 保護者世代がメイン視聴者のため）。
 *
 * @returns YouTube が割り当てた動画 ID (youtube_video_id に保存する値)
 * @throws アップロード失敗時 (network / quota / auth) は例外を投げる
 *   呼び出し側で classifyError して retry / failed を判定する
 */
export async function uploadToYouTube(
  buffer: Buffer,
  metadata: VideoMetadata,
  oauth2Client: OAuth2Client,
): Promise<string> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  // タイトル: "home vs away - YYYY/MM/DD - tournament"
  // YouTube タイトル上限 100 字に収まるよう slice する
  const dateLabel = metadata.startedAt
    ? new Date(metadata.startedAt).toLocaleDateString("ja-JP")
    : "";
  const titleParts = [
    `${metadata.homeTeam} vs ${metadata.awayTeam}`,
    dateLabel,
    metadata.tournament ?? "",
  ].filter((s) => s.length > 0);
  const title = titleParts.join(" - ").slice(0, 100);

  // 説明文: 試合情報 + サービス紹介。YouTube 説明上限 5000 字
  const descriptionParts = [
    metadata.sport,
    metadata.tournament ? `大会: ${metadata.tournament}` : "",
    metadata.venue ? `会場: ${metadata.venue}` : "",
    "",
    "LIVE SPOtCH (https://live-spotch.com) で配信された試合のアーカイブです。",
  ].filter((s) => s.length > 0);
  const description = descriptionParts.join("\n").slice(0, 5000);

  const tags = ["LIVE SPOtCH", metadata.sport, "スポーツ", "アーカイブ"].filter(
    (s) => s.length > 0,
  );

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        categoryId: "17",
        tags,
      },
      status: {
        privacyStatus: "unlisted",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: "video/mp4",
      body: Readable.from(buffer),
    },
  });

  const videoId = res.data.id;
  if (!videoId) {
    throw new Error("YouTube upload returned no video id");
  }
  return videoId;
}

/**
 * googleapis / Supabase Storage SDK / network 等が投げる err を 4 種類に分類。
 * cron handler はこの結果に応じてリトライ戦略を選ぶ。
 *
 * - **auth-refresh**: 401/403 → refresh_token で再認証してから 1 回だけ再試行
 * - **token-revoked**: refresh_token 自体が無効 (ユーザーが連携解除) →
 *   failed 確定 (UI で再連携を促す)
 * - **retry**: 429 / 5xx / network → pending に戻して youtube_retry_count++
 *   (max_retry=5 で failed)
 * - **fatal**: その他 4xx → コード or データの問題なので failed 確定
 */
export type ErrorClass = "retry" | "auth-refresh" | "fatal" | "token-revoked";

export interface ClassifiedError {
  type: ErrorClass;
  status?: number;
  message: string;
}

export function classifyError(err: unknown): ClassifiedError {
  if (typeof err !== "object" || err === null) {
    return { type: "retry", message: String(err) };
  }

  const e = err as {
    code?: number | string;
    message?: string;
    response?: { status?: number };
  };

  const statusFromCode =
    typeof e.code === "number" ? e.code : Number(e.code);
  const statusFromResponse = e.response?.status;
  const status = !Number.isNaN(statusFromCode)
    ? statusFromCode
    : statusFromResponse;
  const message = e.message ?? String(err);

  // refresh_token 無効 (ユーザーが Google 側で連携解除した等)
  // Google OAuth の標準エラーメッセージで判定
  if (
    message.includes("invalid_grant") ||
    message.includes("Token has been expired or revoked") ||
    message.includes("re-link required")
  ) {
    return { type: "token-revoked", status, message };
  }

  if (status === 401 || status === 403) {
    return { type: "auth-refresh", status, message };
  }
  if (
    status === 429 ||
    (typeof status === "number" && status >= 500 && status < 600)
  ) {
    return { type: "retry", status, message };
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { type: "fatal", status, message };
  }

  // status が取れないネットワークエラー等は retry 扱い
  return { type: "retry", status, message };
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
