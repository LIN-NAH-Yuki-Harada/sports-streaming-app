import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import {
  bindBroadcastToStream,
  createLiveBroadcast,
  createLiveStream,
  transitionToComplete,
} from "@/lib/youtube-live";
import { getOAuthClientForProfile } from "@/lib/youtube-upload";
import {
  buildSelfHostRtmpUrl,
  startRtmpEgress,
  startRtmpEgressWithScoreboardTemplate,
} from "@/lib/livekit-rtmp-egress";
import { assertRtmpEgressEnv } from "@/lib/livekit-egress";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

// livekit-server-sdk / googleapis の crypto 系が Edge runtime で動かないため Node.js 強制
export const runtime = "nodejs";

/**
 * Live 中継開始 API（PR-3）
 *
 * 配信者のクライアントが LiveKit に接続成功した直後（onConnected）に
 * fire-and-forget で叩く想定。新パイプライン（YouTube Live RTMP push）の起動口。
 *
 * 起動シーケンス（2026-09-23 改訂）:
 *   1. 自前配信サーバー（MediaMTX）への push URL を用意する ★これは必ず使う
 *   2. YouTube の LiveBroadcast / LiveStream 作成 → bind  ★失敗しても止まらない
 *   3. LiveKit Egress を「自前サーバー（＋取れたら YouTube）」へ RTMP push で起動
 *   4. broadcasts に live_egress_id / live_youtube_* / live_status を保存
 *
 * ★なぜ YouTube を best-effort に落としたか
 *   旧実装は 1〜3 が**直列**で、YouTube 側が1つでもコケると 500 を返して終わっていた。
 *   ブラウザ配信は録画経路と**排他**（broadcast/page.tsx）なので、その瞬間
 *   **Egress が1本も起動せず映像がどこにも残らなかった**。
 *   直近7日で 36本・327分・6名が全損。うち35本が
 *   "The user is not enabled for live streaming."（＝YouTube のライブ権限が無いだけ）。
 *   ライブ権限とアップロード権限は別物で、録画さえ残れば archive-worker が
 *   `videos.insert` で普通に保存できる。だから**録画を先に確保する**。
 *
 * フラグ off / ユーザー設定 off / 既起動 / 配信終了済み のケースは
 * すべて 200 で noop 返却。**4xx は返さない**（クライアント側の毎回 try/catch を
 * 不要にし、フラグ on/off の切替で UX が変わらないようにする）。
 *
 * 呼び出し側（broadcast/page.tsx）の改修は PR-4 で対応。
 */
export async function POST(request: Request) {
  // 1. フラグ off → 即終了（本番デフォルト動作）
  if (!isLiveArchiveEnabled()) {
    return Response.json({ skipped: "flag-off" });
  }

  // 2. 認証
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. LiveKit env チェック（YouTube 系 env は getOAuthClientForProfile 内部で検証）
  // RTMP push は Supabase Storage を経由しないため SUPABASE_S3_* は要求しない。
  try {
    assertRtmpEgressEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : "env error";
    console.error("[live/start]", message);
    return Response.json({ error: "Egress env missing" }, { status: 500 });
  }

  // 4. body から broadcastId
  let broadcastId: string | undefined;
  try {
    const body = (await request.json()) as { broadcastId?: string };
    broadcastId = body.broadcastId;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!broadcastId) {
    return Response.json(
      { error: "broadcastId is required" },
      { status: 400 },
    );
  }

  const admin = getAdminClient();

  // 5. broadcasts を引いて所有権・状態を検証
  // SELECT 文字列は連結せず単一リテラルにする（supabase-js の型推論が template literal で動くため）
  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, status, sport, home_team, away_team, tournament, venue, started_at, live_egress_id, scoreboard_burned_in",
    )
    .eq("id", broadcastId)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (broadcast.status !== "live") {
    return Response.json({ skipped: "not-live", status: broadcast.status });
  }

  // 6. 既に起動済みなら冪等で reuse（再接続で二度叩かれた等）
  if (broadcast.live_egress_id) {
    return Response.json({ reused: broadcast.live_egress_id });
  }

  // 6.5 自前配信サーバー（MediaMTX）への push URL。
  //     ★YouTube の成否と**無関係に**使う。録画はここに残り、archive-worker が拾う。
  const selfHostUrl = buildSelfHostRtmpUrl(broadcast.share_code);

  // 7. profile を引いて Live 中継 opt-in と OAuth トークンを確認
  const { data: profile } = await admin
    .from("profiles")
    .select(
      "id, youtube_access_token, youtube_refresh_token, youtube_live_enabled, youtube_live_privacy",
    )
    .eq("id", user.id)
    .single();

  if (!profile) {
    return Response.json({ skipped: "profile-not-found" });
  }
  // ★未連携なら自前サーバーに録画を残しても archive-worker がアップロードできず、
  //   48時間後に削除されるだけ。ここは従来どおり何もしない。
  if (!profile.youtube_refresh_token) {
    return Response.json({ skipped: "youtube-not-linked" });
  }
  // youtube_live_enabled === false は「YouTube の"ライブ"には出さない」という設定。
  // 録画→アーカイブは別スイッチ（youtube_auto_archive）なので、
  // 自前サーバーへの push は行う＝**試合の映像はきちんと残る**。
  const wantYouTubeLive = profile.youtube_live_enabled !== false;

  // 8〜11. YouTube 側の準備（★best-effort。失敗しても return しない）
  let oauth2Client: Awaited<
    ReturnType<typeof getOAuthClientForProfile>
  > | null = null;
  let liveBroadcastId: string | null = null;
  let streamId: string | null = null;
  let youtubeUrl: string | null = null;
  let youtubeError: string | null = null;

  if (wantYouTubeLive) {
    try {
      oauth2Client = await getOAuthClientForProfile({
        id: profile.id,
        youtube_access_token: profile.youtube_access_token,
        youtube_refresh_token: profile.youtube_refresh_token,
      });

      const privacy: "unlisted" | "private" | "public" =
        profile.youtube_live_privacy === "private" ||
        profile.youtube_live_privacy === "public"
          ? profile.youtube_live_privacy
          : "unlisted";

      const created = await createLiveBroadcast(
        {
          homeTeam: broadcast.home_team,
          awayTeam: broadcast.away_team,
          sport: broadcast.sport,
          tournament: broadcast.tournament,
          venue: broadcast.venue,
          scheduledStartAt: broadcast.started_at,
          shareCode: broadcast.share_code,
          privacy,
        },
        oauth2Client,
      );
      liveBroadcastId = created.broadcastId;

      const stream = await createLiveStream(
        `${broadcast.home_team} vs ${broadcast.away_team} (${broadcast.share_code})`,
        oauth2Client,
      );
      streamId = stream.streamId;

      await bindBroadcastToStream(liveBroadcastId, streamId, oauth2Client);

      // ingest URL の末尾スラッシュ正規化（API が末尾 / 付き／無しで揺れるため）
      youtubeUrl = `${stream.rtmpUrl.replace(/\/+$/, "")}/${stream.streamKey}`;
    } catch (err) {
      youtubeError = err instanceof Error ? err.message : "Unknown error";
      console.error(
        "[live/start] YouTube の準備に失敗（録画は続行します）:",
        youtubeError,
      );
      // 途中まで作れていたら YouTube 側に「開始待ち」が残るので閉じる
      if (liveBroadcastId && oauth2Client) {
        await safeTransitionToComplete(liveBroadcastId, oauth2Client);
      }
      liveBroadcastId = null;
      streamId = null;
      youtubeUrl = null;
    }
  }

  // 12. push 先を組み立てる。
  //     ★先頭は必ず自前サーバー。startEgressWithUrlFallback は
  //       「全部 → 先頭だけ → 次だけ」の順に試すので、録画が最優先で守られる。
  const urls = [selfHostUrl, youtubeUrl].filter((u): u is string => !!u);
  if (urls.length === 0) {
    const message =
      youtubeError ?? "push 先がありません（STREAM_HOST 未設定かつ YouTube も不可）";
    await admin
      .from("broadcasts")
      .update({ live_status: "failed", live_error: message.slice(0, 500) })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "No push destination", message },
      { status: 500 },
    );
  }

  let started: { egressId: string; urls: string[] };
  try {
    if (broadcast.scoreboard_burned_in === false) {
      // 焼き込みOFF（生配信）: スマホはスコアを焼かないので、LiveKit Cloud 側で
      // カメラ＋スコアを合成（RoomComposite + customBaseUrl テンプレート）して push。
      started = await startRtmpEgressWithScoreboardTemplate(
        broadcast.share_code,
        broadcast.id,
        urls,
      );
    } else {
      // 焼き込みON（従来）: スコアは映像に焼き込み済みなので TrackComposite 直送り。
      started = await startRtmpEgress(broadcast.share_code, user.id, urls);
    }
  } catch (err) {
    if (liveBroadcastId && oauth2Client) {
      await safeTransitionToComplete(liveBroadcastId, oauth2Client);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/start] startRtmpEgress failed:", message);
    await admin
      .from("broadcasts")
      .update({ live_status: "failed", live_error: message.slice(0, 500) })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "Egress start failed", message },
      { status: 500 },
    );
  }

  // 12-b. YouTube を用意したのに、Egress が自前サーバーだけで起動した場合
  //       （＝YouTube の ingest に繋がらず fallback した）。
  //       放置すると YouTube 側に「開始待ち」の broadcast が残り続けるので閉じる。
  const youtubeLive = !!youtubeUrl && started.urls.includes(youtubeUrl);
  if (liveBroadcastId && !youtubeLive) {
    if (oauth2Client) {
      await safeTransitionToComplete(liveBroadcastId, oauth2Client);
    }
    youtubeError =
      youtubeError ?? "Egress が YouTube への push を確立できませんでした";
    liveBroadcastId = null;
    streamId = null;
  }

  // 13. DB に記録（stream key は保存しない）
  //   ★live_status は「Egress が動いているか」を表す。ここを 'failed' にすると
  //     live/stop が早期 return して **Egress が止まらなくなる**。
  //     YouTube 側の失敗は live_error に残す。アラート cron は live_error を
  //     単独で拾う（alerts/route.ts）ので、通知はこれまでどおり飛ぶ。
  const { error: uErr } = await admin
    .from("broadcasts")
    .update({
      live_egress_id: started.egressId,
      live_youtube_broadcast_id: liveBroadcastId,
      live_youtube_stream_id: streamId,
      live_status: "creating",
      ...(youtubeError ? { live_error: youtubeError.slice(0, 500) } : {}),
    })
    .eq("id", broadcast.id);
  if (uErr) {
    console.error("[live/start] DB update failed:", uErr.message);
    return Response.json({
      egressId: started.egressId,
      liveBroadcastId,
      streamId,
      youtubeLive,
      selfHostArchive: !!selfHostUrl && started.urls.includes(selfHostUrl),
      dbUpdateFailed: true,
    });
  }

  return Response.json({
    egressId: started.egressId,
    liveBroadcastId,
    streamId,
    // ★終了モーダルの根拠。クライアントはこの2つで表示を出し分ける:
    //   youtubeLive     … YouTube にライブで出ている（＝終了後に自動でアーカイブ化）
    //   selfHostArchive … 自前サーバーに録画中（＝終了後に worker が YouTube へ上げる）
    youtubeLive,
    selfHostArchive: !!selfHostUrl && started.urls.includes(selfHostUrl),
    ...(youtubeError ? { youtubeError } : {}),
  });
}

/**
 * クリーンアップ用の transitionToComplete 呼出ラッパ。
 * complete 自体が失敗しても呼出元の元エラーで返したいので warn のみ。
 */
async function safeTransitionToComplete(
  broadcastId: string,
  oauth2Client: Parameters<typeof transitionToComplete>[1],
): Promise<void> {
  try {
    await transitionToComplete(broadcastId, oauth2Client);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    console.warn(
      `[live/start] cleanup transitionToComplete failed for ${broadcastId}:`,
      message,
    );
  }
}
