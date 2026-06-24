/**
 * Bunny.net Stream Live API クライアント（サーバー専用）。
 *
 * 役割: 配信ごとに Bunny の LiveStream を発行し、ネイティブ RTMP 配信
 * （HaishinKit・端末側スコア焼き込み・720p60）の取り込み先 + HLS 再生 URL を得る。
 * LiveKit Ingress lib（livekit-ingress / livekit-egress）と同型の薄いヘルパ。
 *
 * 設計の要点:
 * - base URL は https://video.bunnycdn.com、認証は HTTP ヘッダ `AccessKey`（per-library Stream API Key）。
 *   ※ アカウント全体の Core API key（api.bunny.net 用）とは別物。混同すると 401。
 * - CreateLiveStream のレスポンスには **RTMP ingest ホスト名は含まれない**（仕様）。
 *   ingest URL（rtmp://…）は Bunny ダッシュボードの固定値なので env BUNNY_RTMP_INGEST_URL から読む。
 * - `streamKey` は publish 秘密。DB に保存せず、provisioning API のレスポンスでのみ
 *   信頼できる配信者アプリに渡す（YouTube/LiveKit の stream key と同じ扱い）。ログにも残さない。
 *
 * 参照: docs.bunny.net OpenAPI（/library/{libraryId}/live …）、
 *       LiveStreamStatus enum 0=Unknown,1=Created,2=Scheduled,3=Preview,4=Running,5=Ended,6=VodProcessing,7=Error。
 */

const BUNNY_BASE = "https://video.bunnycdn.com";

export type BunnyLiveStream = {
  /** Bunny LiveStream の GUID（= streamId）。VOD 化後も再生キーになる。 */
  guid: string;
  /** publish 秘密。完全 RTMP URL = `${rtmpIngestUrl}/${streamKey}`。保存・ログ厳禁。 */
  streamKey: string;
  /** HLS 再生 URL（.m3u8 ABR マスター）。視聴側がそのまま再生。公開してよい。 */
  playbackUrl: string;
  /** RTMP 取り込みサーバー URL（API には無く env 由来）。 */
  rtmpIngestUrl: string;
  /** Bunny が割り当てた ingest リージョン（監視用・無ければ null）。 */
  ingestRegion: string | null;
};

function bunnyEnv(): { apiKey: string; libraryId: string; rtmpIngestUrl: string } {
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  const libraryId = process.env.BUNNY_LIBRARY_ID;
  const rtmpIngestUrl = process.env.BUNNY_RTMP_INGEST_URL;
  if (!apiKey || !libraryId || !rtmpIngestUrl) {
    const missing = [
      ["BUNNY_STREAM_API_KEY", apiKey],
      ["BUNNY_LIBRARY_ID", libraryId],
      ["BUNNY_RTMP_INGEST_URL", rtmpIngestUrl],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    throw new Error(`Bunny env missing: ${missing.join(", ")}`);
  }
  return { apiKey, libraryId, rtmpIngestUrl };
}

/** ルート開始時の事前検証（env 不足を 500 で早期に返すため）。 */
export function assertBunnyEnv(): void {
  bunnyEnv();
}

/**
 * 配信ごとに Bunny LiveStream を作成し、取り込み/再生情報を返す。
 * recordVod=true で試合後の VOD（→ YouTube アーカイブ）を自動生成。
 * public=true（token auth OFF）で共有コードによる即視聴（ログイン不要）を維持。
 */
export async function createBunnyLiveStream(title: string): Promise<BunnyLiveStream> {
  const { apiKey, libraryId, rtmpIngestUrl } = bunnyEnv();

  const res = await fetch(`${BUNNY_BASE}/library/${libraryId}/live`, {
    method: "POST",
    headers: {
      AccessKey: apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      title: title.slice(0, 200),
      recordVod: true,
      public: true,
      dvrEnabled: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bunny createLiveStream failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    guid?: string;
    streamKey?: string;
    playbackUrlHls?: string;
    ingestRegion?: string | null;
  };

  if (!data.guid || !data.streamKey || !data.playbackUrlHls) {
    // streamKey はログに出さないため keys のみ出力
    throw new Error(
      `Bunny createLiveStream incomplete response (keys: ${Object.keys(data).join(",")})`,
    );
  }

  return {
    guid: data.guid,
    streamKey: data.streamKey,
    playbackUrl: data.playbackUrlHls,
    rtmpIngestUrl,
    ingestRegion: data.ingestRegion ?? null,
  };
}

/**
 * Bunny LiveStream を停止する（配信終了時）。
 * 停止後 recordVod=true なら status 5=Ended → 6=VodProcessing → VOD Video 化。
 */
export async function stopBunnyLiveStream(guid: string): Promise<void> {
  const { apiKey, libraryId } = bunnyEnv();
  const res = await fetch(`${BUNNY_BASE}/library/${libraryId}/live/${guid}/stop`, {
    method: "PUT",
    headers: { AccessKey: apiKey, accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bunny stopLiveStream failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

/**
 * Bunny LiveStream を削除する（孤児リソースの回収用）。
 * 既に存在しない（404）場合は成功扱いにする（冪等）。
 */
export async function deleteBunnyLiveStream(guid: string): Promise<void> {
  const { apiKey, libraryId } = bunnyEnv();
  const res = await fetch(`${BUNNY_BASE}/library/${libraryId}/live/${guid}`, {
    method: "DELETE",
    headers: { AccessKey: apiKey, accept: "application/json" },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bunny deleteLiveStream failed: ${res.status} ${text.slice(0, 300)}`);
  }
}
