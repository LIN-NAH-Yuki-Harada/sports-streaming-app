import {
  StreamOutput,
  StreamProtocol,
  EncodingOptions,
  AudioCodec,
  VideoCodec,
  TrackType,
} from "livekit-server-sdk";
import { getEgressClient, getRoomServiceClient } from "./livekit-egress";

/**
 * RTMP push 用の EncodingOptions（YouTube Live 受信品質を最大化）。
 *
 * 5/06 改修:
 * - 配信側 1080p → 720p 引き下げ（user-agent.ts pickBroadcastResolution）に
 *   合わせて Egress も 720p に統一。元素材より高い解像度を Egress 側で
 *   宣言してもアップスケール限界で品質改善せず、bitrate を無駄に消費するため。
 * - videoBitrate: 8 Mbps → 4 Mbps（YouTube 推奨 720p30 bitrate 1.5-4 Mbps の上限）→ 6/21: 4→6 Mbps（推奨レンジ上限・デメリットなし）
 * - videoCodec: H264_MAIN → **H264_HIGH**（同 bitrate で 10-15% 圧縮効率 UP、
 *   互換性は iOS/Android/PC ブラウザほぼ全部 OK）
 * - keyFrameInterval: 2 → **1 秒**（動きの多いシーンチェンジ・カメラパンで
 *   品質安定。データ量 +5-10% 程度）
 *
 * 不変:
 * - audioCodec: AAC（YouTube Live ingest が必須要件）
 * - audioBitrate: 128 kbps（音声品質維持）
 *
 * 配信者スマホへの負荷ゼロ（LiveKit Cloud 側の処理）。
 * transcode minutes は時間ベースのため bitrate 変更で消費量変化なし。
 */
const RTMP_HIGH_QUALITY_ENCODING = new EncodingOptions({
  width: 1280,
  height: 720,
  framerate: 30,
  videoCodec: VideoCodec.H264_HIGH,
  videoBitrate: 6_000,
  keyFrameInterval: 1,
  audioCodec: AudioCodec.AAC,
  audioBitrate: 128,
  // 9/23: 44_100 → 48_000。配信元(Opus)も、受け側の archive-worker の
  // `aresample=48000` も 48kHz で、ここだけが 44.1kHz だった。
  // 途中で一度 44.1 に落として戻すぶん、無駄なリサンプルが1段入っていた。
  audioFrequency: 48_000,
});

/**
 * LiveKit Egress を **RTMP push** 出力で起動する（Live 中継移行 PR-3）。
 *
 * 既存の livekit-egress.ts は S3 出力（録画→アップロード）専用。本ファイルは
 * 同じ EgressClient を使いつつ、Output だけ StreamOutput に切り替える。
 *
 * 仕組み:
 *   LiveKit Cloud のサーバー側で配信ルームを composite して、得られた映像/音声を
 *   指定された RTMP URL に push する。本サービスでは YouTube Live ingest を
 *   destination とする想定。
 *
 * フラグ NEXT_PUBLIC_LIVE_ARCHIVE が false の間はどこからも呼ばれない。
 * PR-3 単体マージ時は本番動作に影響なし。
 *
 * 呼び出し元: web/src/app/api/livekit/live/start/route.ts (PR-3 で実装)
 */

/**
 * 自前配信サーバー（MediaMTX on VPS）への publish URL を組み立てる。
 *
 * ★なぜブラウザ配信をここに流すのか（2026-09-23）
 *   ブラウザ配信は「YouTube Live 同時配信」に一本化されていたため、YouTube 側で
 *   ライブ配信が有効になっていない配信者は `liveBroadcasts.insert` が 500 になり、
 *   **Egress が1本も起動せず映像がどこにも残らなかった**。
 *   直近7日で 36本・327分・6名が全損し、うち35本が同一エラー
 *   （"The user is not enabled for live streaming."）。
 *
 *   YouTube の「ライブ配信」と「動画アップロード」は**別の権限**で、後者は
 *   電話番号確認が不要。つまりこの35本は、録画さえ残っていれば
 *   archive-worker が `videos.insert` で普通に保存できたものだった。
 *
 *   そこで YouTube を best-effort に降格し、**自前サーバーへの push は必ず行う**。
 *   録画された MP4 は既存の archive-worker がそのまま拾う（アプリ RTMP 経路と同じ形）。
 *
 * ★形式は /api/stream/provision と完全に同じでなければならない
 *   MediaMTX の path は "live/<共有コード>" の**2要素**。認証はクエリで渡す。
 *   （worker.js が録画を `/var/recordings/live/<code>/` で探すため、ここを変えると拾われない）
 *
 * env が無い場合は null を返す（＝自前 push なしで従来どおり YouTube だけ）。
 * .trim() 必須: 本番の STREAM_HOST には実際に前後の空白が入っていた実績がある。
 */
export function buildSelfHostRtmpUrl(shareCode: string): string | null {
  const host = process.env.STREAM_HOST?.trim();
  const secret = process.env.STREAM_PUBLISH_SECRET?.trim();
  const pubUser = (process.env.STREAM_PUBLISH_USER || "spotch").trim();
  if (!host || !secret) return null;
  return (
    `rtmp://${host}/live/${shareCode}` +
    `?user=${encodeURIComponent(pubUser)}&pass=${encodeURIComponent(secret)}`
  );
}

/**
 * 自前サーバーの HLS 視聴 URL。**配信終了時にだけ** broadcasts に書き込む。
 *
 * ★なぜ開始時に書かないのか（この設計の肝）
 *   この列は3つの役目を兼ねており、配信中に立てると副作用が出る:
 *     1. archive-worker の取得条件（`stream_playback_url IS NOT NULL`）… 終了後に必要
 *     2. 視聴ページの経路選択（watch/[code]/page.tsx）… 立てると LiveKit(ほぼ実時間)から
 *        **HLS(約11秒遅延)に退行する**
 *     3. ghost sweep の対象条件（status='live' かつ非 null）… 自前 push が落ちただけで
 *        **試合中の配信を強制終了しうる**
 *   終了時にだけ書けば 1 の目的だけを満たし、2 と 3 には一度も引っかからない。
 */
export function buildSelfHostPlaybackUrl(shareCode: string): string | null {
  const host = process.env.STREAM_HOST?.trim();
  const playbackHost = process.env.STREAM_PLAYBACK_HOST?.trim() || host;
  if (!playbackHost) return null;
  return `https://${playbackHost}/live/${shareCode}/index.m3u8`;
}

/**
 * 配信者の publish track ID を取得する。
 *
 * LiveKit に publish 済みの participant 一覧から、broadcasterIdentity と
 * 一致する participant を探し、その audio/video track の sid (track ID) を返す。
 *
 * 配信開始直後はまだ publish 完了していない可能性があるため、最大 5 回
 * 1 秒間隔でリトライする。それでも見つからなければ null を返す
 * （呼び出し元で RoomCompositeEgress フォールバック）。
 */
async function waitForBroadcasterTracks(
  roomName: string,
  broadcasterIdentity: string,
  maxAttempts = 5,
): Promise<{ audioTrackId: string; videoTrackId: string } | null> {
  const roomService = getRoomServiceClient();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const participants = await roomService.listParticipants(roomName);
      const broadcaster = participants.find(
        (p) => p.identity === broadcasterIdentity,
      );
      if (broadcaster) {
        const audioTrack = broadcaster.tracks.find(
          (t) => t.type === TrackType.AUDIO,
        );
        const videoTrack = broadcaster.tracks.find(
          (t) => t.type === TrackType.VIDEO,
        );
        if (audioTrack && videoTrack) {
          return { audioTrackId: audioTrack.sid, videoTrackId: videoTrack.sid };
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown";
      console.warn(
        `[rtmp-egress] listParticipants attempt ${attempt + 1} failed: ${message}`,
      );
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

/**
 * push 先の候補を**順に試して**、起動できた組み合わせで Egress を立てる。
 *
 * ★なぜ「全部まとめて1本」では駄目か（2026-09-23）
 *   LiveKit の StreamOutput は urls を配列で受け取れるが、**起動時に1つでも
 *   接続できないと Egress ごと失敗する**。
 *   つまり YouTube と自前サーバーを素朴に並べると、
 *     - 自前サーバーが落ちている → これまで動いていた YouTube 同時配信まで道連れ
 *     - YouTube の stream key が無効  → 残したかった録画まで道連れ
 *   となり、**片方を助けるために片方を壊す**。
 *
 *   そこで「①両方 → ②先頭だけ → ③次だけ」の順に試す。
 *   urls の**先頭を自前サーバー**にしておけば、②で録画が最優先で守られる。
 *
 * @returns 実際に起動できた egressId と、その時点で生きている宛先
 */
async function startEgressWithUrlFallback(
  urls: string[],
  start: (output: StreamOutput) => Promise<string>,
): Promise<{ egressId: string; urls: string[] }> {
  const candidates: string[][] = [urls];
  if (urls.length > 1) {
    for (const u of urls) candidates.push([u]);
  }

  let lastError: unknown = new Error("no url candidates");
  for (const set of candidates) {
    try {
      const output = new StreamOutput({
        protocol: StreamProtocol.RTMP,
        urls: set,
      });
      const egressId = await start(output);
      if (set.length < urls.length) {
        console.warn(
          `[rtmp-egress] 一部の宛先を諦めて起動しました ` +
            `(${set.length}/${urls.length} 本): ${set.map(redactUrl).join(", ")}`,
        );
      }
      return { egressId, urls: set };
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : "Unknown";
      console.warn(
        `[rtmp-egress] 起動失敗 (${set.map(redactUrl).join(", ")}): ${message}`,
      );
    }
  }
  throw lastError;
}

/**
 * ログに出す用に URL の秘密部分を伏せる。
 *
 * ★**パスの1要素目までしか残さない**。
 *   YouTube は `rtmp://a.rtmp.youtube.com/live2/<stream key>` で、
 *   **2要素目そのものが秘密**。3要素残す実装にすると配信キーが
 *   そのまま Vercel のログに載る（2026-09-23 のレビューで発見）。
 *   自前サーバー側の `?user=&pass=` は search を捨てるので落ちる。
 *
 *   共有コードも消えるが、呼び出し元のログ行に別途出ているので困らない。
 */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const app = u.pathname.split("/").slice(0, 2).join("/");
    return `${u.protocol}//${u.host}${app}/***`;
  } catch {
    return "***";
  }
}

/**
 * RTMP push を開始する（焼き込みONの配信）。
 *
 * **Egress 種別の選択（5/04 改修）**:
 *   優先: TrackCompositeEgress（配信者の publish track を直接 RTMP push）
 *   fallback: RoomCompositeEgress（仮想 Chrome で room 全体を再合成して push）
 *
 *   TrackComposite は仮想 Chrome 合成を経由しないため再エンコードが 1 段
 *   減り、受信品質が大幅に改善する（配信者は既に Canvas で
 *   スコアボード焼き込み済みのため再合成は不要）。
 *
 * @param roomName LiveKit ルーム名（broadcasts.share_code と同じ）
 * @param broadcasterIdentity 配信者の identity（= Supabase user.id）
 * @param urls push 先。**先頭を自前サーバーにすること**（上の fallback の前提）
 */
export async function startRtmpEgress(
  roomName: string,
  broadcasterIdentity: string,
  urls: string[],
): Promise<{ egressId: string; urls: string[] }> {
  // 案 B: TrackCompositeEgress を優先試行（仮想 Chrome 合成を経由しないため
  // 抜本的に画質が改善する）。track が引けるかは宛先と無関係なので先に1回だけ調べる。
  const trackIds = await waitForBroadcasterTracks(roomName, broadcasterIdentity);
  if (!trackIds) {
    console.warn(
      "[rtmp-egress] broadcaster track が listParticipants で見つからず → " +
        "RoomCompositeEgress フォールバック",
    );
  }

  return startEgressWithUrlFallback(urls, async (output) => {
    if (trackIds) {
      try {
        const info = await getEgressClient().startTrackCompositeEgress(
          roomName,
          output,
          {
            audioTrackId: trackIds.audioTrackId,
            videoTrackId: trackIds.videoTrackId,
            encodingOptions: RTMP_HIGH_QUALITY_ENCODING,
          },
        );
        console.log(
          `[rtmp-egress] TrackCompositeEgress 開始 (egressId=${info.egressId}, ` +
            `audio=${trackIds.audioTrackId}, video=${trackIds.videoTrackId})`,
        );
        return info.egressId;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown";
        console.warn(
          `[rtmp-egress] TrackCompositeEgress 失敗 → RoomCompositeEgress フォールバック: ${message}`,
        );
      }
    }

    const info = await getEgressClient().startRoomCompositeEgress(
      roomName,
      output,
      {
        layout: "speaker",
        encodingOptions: RTMP_HIGH_QUALITY_ENCODING,
        audioOnly: false,
        videoOnly: false,
      },
    );
    console.log(
      `[rtmp-egress] RoomCompositeEgress (fallback) 開始 (egressId=${info.egressId})`,
    );
    return info.egressId;
  });
}

/**
 * RTMP push を **カスタムテンプレート合成** で開始する（発熱対策 Phase 1-D）。
 *
 * 焼き込みOFF（生配信）の配信者は、スコアを映像に焼き込まずカメラ生映像だけを publish する
 * （＝スマホ無負荷・冷たい）。配信先にはスコア入り映像を出したいので、合成を LiveKit Cloud
 * 側で行う:
 *   RoomCompositeEgress + customBaseUrl で自前テンプレート `/egress-template` を読み込ませ、
 *   LiveKit Cloud の Chrome が「カメラ映像 ＋ スコアボード（Supabase Realtime）」を合成 →
 *   その画面を RTMP で push する。
 *
 * 通常の RTMP（startRtmpEgress）は TrackComposite（生 track 直送り）なので、スコアを
 * 重ねられない。本関数は必ず RoomComposite（仮想 Chrome 合成）を使う。
 *
 * @param roomName LiveKit ルーム名（= share_code）
 * @param broadcastId テンプレートに渡す broadcast id（スコア取得・描画に使用）
 * @param urls push 先。**先頭を自前サーバーにすること**
 */
export async function startRtmpEgressWithScoreboardTemplate(
  roomName: string,
  broadcastId: string,
  urls: string[],
): Promise<{ egressId: string; urls: string[] }> {
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com"
  ).replace(/\/+$/, "");
  const customBaseUrl = `${siteUrl}/egress-template?broadcastId=${broadcastId}`;

  return startEgressWithUrlFallback(urls, async (output) => {
    const info = await getEgressClient().startRoomCompositeEgress(
      roomName,
      output,
      {
        layout: "single-speaker",
        encodingOptions: RTMP_HIGH_QUALITY_ENCODING,
        customBaseUrl,
        audioOnly: false,
        videoOnly: false,
      },
    );
    console.log(
      `[rtmp-egress] スコア合成テンプレート RoomCompositeEgress 開始 ` +
        `(egressId=${info.egressId}, broadcastId=${broadcastId})`,
    );
    return info.egressId;
  });
}

/**
 * RTMP push 中の Egress を停止する。
 *
 * 既存 livekit-egress.ts の停止処理と同じく EgressClient.stopEgress を呼ぶだけ。
 * RTMP 切断を YouTube 側が検知すると enableAutoStop=true により Live broadcast が
 * 自動で complete に遷移してアーカイブ動画化される。
 *
 * 停止後は egress_ended webhook が飛ぶ → egress-webhook が live_status='ended'
 * を書き込む。
 */
export async function stopRtmpEgress(egressId: string): Promise<void> {
  await getEgressClient().stopEgress(egressId);
}
