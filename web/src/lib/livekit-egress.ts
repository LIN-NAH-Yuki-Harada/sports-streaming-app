import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from "livekit-server-sdk";

/**
 * LiveKit Egress クライアントの構築と S3 出力設定の集約点。
 *
 * Egress = LiveKit Cloud のサーバー側で配信ルームを録画し、結果 MP4 を
 * 外部ストレージ (Supabase Storage の S3 互換 API) にアップロードする機能。
 * 配信者の端末を経由しない（端末の負荷ゼロ）ため、夏発熱対策とも矛盾しない。
 *
 * Sprint A2 (Egress 起動 API) と Sprint A3 (webhook) から呼ばれる。
 * Sprint A1 段階では誰も呼ばないため、フラグ off で本番に出ても無害。
 */

let cachedClient: EgressClient | null = null;

/**
 * EgressClient のシングルトン取得。
 * wss:// のクライアント URL を https:// に変換して Twirp RPC エンドポイントとして使う。
 */
export function getEgressClient(): EgressClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      "Egress env missing: NEXT_PUBLIC_LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET",
    );
  }

  const httpUrl = url
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");

  cachedClient = new EgressClient(httpUrl, apiKey, apiSecret);
  return cachedClient;
}

/**
 * Egress の MP4 出力設定（Supabase Storage を S3 互換として書き込み）。
 * filepath は LiveKit が `{time}` を ISO8601 で展開する。実際に書き込まれた
 * 最終 key は webhook の EgressInfo.fileResults[0].filename を正として保存する
 * （クライアント側の予測値はミリ秒ズレで使い物にならない）。
 *
 * forcePathStyle は Supabase Storage の S3 API が virtual-host style を
 * サポートしないために必須。
 */
export function buildRecordingOutput(
  shareCode: string,
  broadcastId: string,
): EncodedFileOutput {
  const accessKey = process.env.SUPABASE_S3_ACCESS_KEY;
  const secretKey = process.env.SUPABASE_S3_SECRET_KEY;
  const region = process.env.SUPABASE_S3_REGION;
  const endpoint = process.env.SUPABASE_S3_ENDPOINT;
  const bucket = process.env.SUPABASE_STORAGE_RECORDINGS_BUCKET ?? "recordings";

  if (!accessKey || !secretKey || !region || !endpoint) {
    throw new Error(
      "Egress env missing: SUPABASE_S3_ACCESS_KEY / SUPABASE_S3_SECRET_KEY / SUPABASE_S3_REGION / SUPABASE_S3_ENDPOINT",
    );
  }

  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `${shareCode}/${broadcastId}-{time}.mp4`,
    disableManifest: true,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey,
        secret: secretKey,
        region,
        endpoint,
        bucket,
        forcePathStyle: true,
      }),
    },
  });
}

/**
 * Egress 開始/停止 API の冒頭で呼ぶ事前検証。env 1 つでも欠けたら
 * ここで早期に分かりやすいエラーにして 500 を返す。
 */
export function assertEgressEnv(): void {
  const required = [
    "NEXT_PUBLIC_LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "SUPABASE_S3_ACCESS_KEY",
    "SUPABASE_S3_SECRET_KEY",
    "SUPABASE_S3_REGION",
    "SUPABASE_S3_ENDPOINT",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Egress env missing: ${missing.join(", ")}`);
  }
}
