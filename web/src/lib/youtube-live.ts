import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// classifyError は upload 側と同じ分類で十分なので再利用する
// （PR-6 で旧パイプライン撤去するときに共通モジュールへ切り出してもよい）
export { classifyError, type ClassifiedError, type ErrorClass } from "./youtube-upload";

/**
 * YouTube Live broadcast 作成時に必要な試合メタデータ。
 * broadcasts 行から必要な情報だけ抜粋する。
 */
export interface LiveBroadcastMetadata {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  tournament: string | null;
  venue: string | null;
  /** 配信予定開始時刻 (ISO 8601)。YouTube の scheduledStartTime に渡す */
  scheduledStartAt: string;
  shareCode: string;
  /** 公開範囲。profiles.youtube_live_privacy の値を渡す（PR-1 で追加） */
  privacy: "unlisted" | "private" | "public";
}

/**
 * createLiveBroadcast の戻り値。broadcasts.live_youtube_broadcast_id に保存する。
 */
export interface LiveBroadcastInfo {
  /** YouTube Live broadcast resource ID（= 公開時の video ID と一致） */
  broadcastId: string;
  /** 視聴 URL に組み立てるための watch ID（broadcastId と同じ）*/
  watchId: string;
}

/**
 * createLiveStream の戻り値。**streamKey は短命**（配信ごとに即廃棄）。
 *
 * - streamId は broadcasts.live_youtube_stream_id に保存する
 * - rtmpUrl + streamKey は LiveKit Egress (RTMP push) の dest URL 組み立てに使い、
 *   構成後はメモリから捨てる。DB に保存しない。
 */
export interface LiveStreamInfo {
  /** YouTube Live stream resource ID（broadcast との bind / status 取得に使用） */
  streamId: string;
  /** RTMP ingest URL (例: rtmp://a.rtmp.youtube.com/live2) */
  rtmpUrl: string;
  /** ingest URL に紐づく stream key（= 認証トークン相当）。**永続化しない** */
  streamKey: string;
}

/**
 * stream の RTMP 受信状態。LiveKit Egress 起動後の生存監視に使う。
 *
 * - active = RTMP データ受信中（YouTube 側が live 開始判定済み）
 * - ready = stream resource は作成済みだが RTMP データ未受信
 * - inactive = 未開始 or 切断後
 */
export interface StreamStatus {
  streamStatus: string;
  healthStatus: string | null;
}

// ============================================
// API helpers
// ============================================

/**
 * YouTube Live broadcast resource を新規作成する。
 *
 * **enableAutoStart / enableAutoStop = true** に設定するため、RTMP 受信開始時に
 * YouTube が自動で testing → live に遷移し、RTMP 切断時に自動で complete に
 * 遷移する。手動 transition は基本不要だが、エラー復旧用に transitionToLive /
 * transitionToComplete も提供する。
 *
 * 戻り値の broadcastId は YouTube 上の video ID と一致するため、配信終了後は
 * https://www.youtube.com/watch?v={broadcastId} がアーカイブ動画 URL になる。
 *
 * 必要 OAuth scope: `https://www.googleapis.com/auth/youtube`
 *
 * @throws insert 失敗時 (network / quota / auth) は例外を投げる。
 *   classifyError して retry / failed を判定する。
 */
export async function createLiveBroadcast(
  metadata: LiveBroadcastMetadata,
  oauth2Client: OAuth2Client,
): Promise<LiveBroadcastInfo> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  // タイトル: "home vs away - YYYY/MM/DD - tournament"
  // YouTube タイトル上限 100 字に収まるよう slice する
  // Vercel 実行環境は UTC のため timeZone を明示しないと JST 早朝の配信が前日付になる
  const dateLabel = new Date(metadata.scheduledStartAt).toLocaleDateString(
    "ja-JP",
    { timeZone: "Asia/Tokyo" },
  );
  const titleParts = [
    `${metadata.homeTeam} vs ${metadata.awayTeam}`,
    dateLabel,
    metadata.tournament ?? "",
  ].filter((s) => s.length > 0);
  const title = titleParts.join(" - ").slice(0, 100);

  const descriptionParts = [
    metadata.sport,
    metadata.tournament ? `大会: ${metadata.tournament}` : "",
    metadata.venue ? `会場: ${metadata.venue}` : "",
    "",
    "LIVE SPOtCH (https://live-spotch.com) で配信中の試合のライブストリームです。",
  ].filter((s) => s.length > 0);
  const description = descriptionParts.join("\n").slice(0, 5000);

  const res = await youtube.liveBroadcasts.insert({
    part: ["snippet", "status", "contentDetails"],
    requestBody: {
      snippet: {
        title,
        description,
        scheduledStartTime: metadata.scheduledStartAt,
      },
      status: {
        privacyStatus: metadata.privacy,
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        // RTMP データ受信時に自動で testing → live に遷移
        enableAutoStart: true,
        // RTMP 切断時に自動で live → complete に遷移（アーカイブ自動生成）
        enableAutoStop: true,
        // DVR 有効化（視聴者がライブ中に巻き戻し可能）
        enableDvr: true,
        // monitor stream 無効化（追加コスト発生、本サービスでは不要）
        monitorStream: { enableMonitorStream: false },
      },
    },
  });

  const broadcastId = res.data.id;
  if (!broadcastId) {
    throw new Error("YouTube liveBroadcasts.insert returned no id");
  }
  return { broadcastId, watchId: broadcastId };
}

/**
 * YouTube Live stream resource を新規作成し、RTMP ingest URL + Stream Key を取得する。
 *
 * Stream Key は **YouTube アカウントへの配信権限とほぼ等価** なので、
 * 取得後は LiveKit Egress に渡してすぐ破棄する。DB に永続化してはならない。
 *
 * 解像度 1080p / 30fps を指定（LiveKit publish と Egress preset を 1080p に統一）。
 * YouTube が「ingest 解像度の宣言」より小さい値を受け取ると追加ダウンスケールが
 * 入って画質劣化するため、配信側のチェーン全体で 1080p を貫く。
 * isReusable=false で 1 試合 = 1 stream resource を強制（key の漏洩リスク最小化）。
 *
 * 必要 OAuth scope: `https://www.googleapis.com/auth/youtube`
 *
 * @param title 配信タイトル（YouTube Studio に表示）。LiveBroadcast と揃える
 *   と運用しやすい。
 */
export async function createLiveStream(
  title: string,
  oauth2Client: OAuth2Client,
): Promise<LiveStreamInfo> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const res = await youtube.liveStreams.insert({
    part: ["snippet", "cdn", "contentDetails"],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
      },
      cdn: {
        frameRate: "30fps",
        ingestionType: "rtmp",
        // 配信チェーン全体で 1080p に統一（LiveKit publish 1080p / 5Mbps,
        // Egress preset H264_1080P_30, YouTube ingest 1080p）。
        // 720p 宣言だと Egress 1080p 出力に対して YouTube が追加ダウンスケール
        // を行い画質劣化が生じるため 1080p で揃える。
        resolution: "1080p",
      },
      contentDetails: {
        isReusable: false,
      },
    },
  });

  const streamId = res.data.id;
  const ingestionInfo = res.data.cdn?.ingestionInfo;
  const rtmpUrl = ingestionInfo?.ingestionAddress;
  const streamKey = ingestionInfo?.streamName;

  if (!streamId || !rtmpUrl || !streamKey) {
    throw new Error(
      "YouTube liveStreams.insert returned incomplete ingestion info",
    );
  }

  return { streamId, rtmpUrl, streamKey };
}

/**
 * Live broadcast に Live stream を bind する。
 *
 * bind 完了後は broadcast が「stream からの RTMP 入力を待つ状態」になり、
 * 実際に RTMP データを受信し始めると enableAutoStart=true により自動で
 * live ステータスに遷移する。
 *
 * 必要 OAuth scope: `https://www.googleapis.com/auth/youtube`
 */
export async function bindBroadcastToStream(
  broadcastId: string,
  streamId: string,
  oauth2Client: OAuth2Client,
): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  await youtube.liveBroadcasts.bind({
    id: broadcastId,
    streamId,
    part: ["id", "contentDetails"],
  });
}

/**
 * Live broadcast を強制的に live ステータスに遷移させる。
 *
 * 通常は enableAutoStart=true により YouTube が自動遷移するため不要。
 * RTMP 受信が始まっているのに live になっていない異常時の救済用。
 *
 * 必要 OAuth scope: `https://www.googleapis.com/auth/youtube`
 */
export async function transitionToLive(
  broadcastId: string,
  oauth2Client: OAuth2Client,
): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  await youtube.liveBroadcasts.transition({
    id: broadcastId,
    broadcastStatus: "live",
    part: ["status"],
  });
}

/**
 * Live broadcast を complete ステータスに遷移させる（アーカイブ動画確定）。
 *
 * 通常は enableAutoStop=true により RTMP 切断時に YouTube が自動遷移するため不要。
 * 手動で配信を打ち切る場合や AutoStop が動かなかった異常時の救済用。
 *
 * complete に遷移すると broadcast.id（= video ID）でアーカイブ動画として
 * チャンネルに残る。privacy はそのまま継承される。
 *
 * 必要 OAuth scope: `https://www.googleapis.com/auth/youtube`
 */
export async function transitionToComplete(
  broadcastId: string,
  oauth2Client: OAuth2Client,
): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  await youtube.liveBroadcasts.transition({
    id: broadcastId,
    broadcastStatus: "complete",
    part: ["status"],
  });
}

/**
 * Live stream の現在状態を取得する。LiveKit Egress 起動後に
 * 「YouTube が RTMP を実際に受信できているか」を確認する用途。
 *
 * - streamStatus: 'created' | 'ready' | 'active' | 'inactive' | 'error'
 * - healthStatus: 'good' | 'ok' | 'bad' | 'noData' 等
 *
 * 必要 OAuth scope: `https://www.googleapis.com/auth/youtube`
 *   または `https://www.googleapis.com/auth/youtube.readonly`
 */
export async function getStreamStatus(
  streamId: string,
  oauth2Client: OAuth2Client,
): Promise<StreamStatus> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  const res = await youtube.liveStreams.list({
    id: [streamId],
    part: ["status"],
  });

  const item = res.data.items?.[0];
  if (!item) {
    throw new Error(`YouTube liveStreams.list returned no item for ${streamId}`);
  }

  return {
    streamStatus: item.status?.streamStatus ?? "inactive",
    healthStatus: item.status?.healthStatus?.status ?? null,
  };
}
