import { supabase } from "./supabase";
import { SITE_URL } from "../config";

// broadcasts テーブル用のデータ層ヘルパー（React Native 専用・DOM/Node API 不使用）。
// Web 版（web/src/lib/database.ts）の挙動・カラム名と完全に一致させること。
// 視聴ページ live-spotch.com/watch/<share_code> のスコアボードへ Realtime で反映される。

// 配信レコードを新規作成（status=live で開始）。
// カラム名は Web の createBroadcast / App.tsx の insert と完全一致させる。
// 戻り値に broadcasts.id(UUID) を返す（YouTube同時配信 live/start のボディに必要）。
// ※ id は BROADCAST_PUBLIC_COLUMNS に含まれ列GRANT済みなので .select("id") は通る
//   （引数なし .select() は 42501 になるので必ず列を明示する）。
export async function createBroadcast(args: {
  broadcasterId: string;
  shareCode: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  tournament: string;
  teamId?: string | null;
  initialPeriod: string;
}): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({
      broadcaster_id: args.broadcasterId,
      share_code: args.shareCode,
      sport: args.sport,
      home_team: args.homeTeam,
      away_team: args.awayTeam,
      // 大会名は空なら null（Web 版に合わせる）
      tournament: args.tournament || null,
      team_id: args.teamId ?? null,
      period: args.initialPeriod,
      home_score: 0,
      away_score: 0,
      home_sets: 0,
      away_sets: 0,
      status: "live",
      // 発熱対策で焼き込みは既定 OFF（生配信・サーバー合成）
      scoreboard_burned_in: false,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: (data as { id: string } | null)?.id };
}

// YouTube同時配信＋自動アーカイブを起動（fire-and-forget・配信を止めない付加機能）。
// サーバー(/api/livekit/live/start)が YouTube broadcast/stream作成→bind→LiveKit Cloud Egress起動を
// 全部やる（スコア合成もサーバー側Chrome＝端末は無負荷）。前提（本番フラグ NEXT_PUBLIC_LIVE_ARCHIVE /
// 配信者のYouTube連携 / profiles.youtube_live_enabled）が揃わない時は 200 {skipped} で何も起きない。
// 戻り値 liveBroadcastId: 起動成功時は YouTube video ID（共有用 https://youtu.be/{id}）。skip/失敗時 null。
export async function startLiveStream(
  broadcastId: string,
): Promise<{ liveBroadcastId: string | null }> {
  // live/start は YouTube broadcast/stream作成→bind→Egress起動で10-20秒かかるため余裕をもって45秒
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { liveBroadcastId: null };
    const res = await fetch(`${SITE_URL}/api/livekit/live/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ broadcastId }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      liveBroadcastId?: string;
    };
    return { liveBroadcastId: json?.liveBroadcastId ?? null };
  } catch {
    return { liveBroadcastId: null };
  } finally {
    clearTimeout(t);
  }
}

// ===== Bunny.net Stream（ネイティブ RTMP 配信）=====

// 配信ごとの取り込み先（完全 RTMP URL）＋ HLS 再生 URL を取得する。
// サーバー（/api/bunny/live/start）が Bunny LiveStream を発行し rtmpUrl/streamKey/playbackUrl を返す。
// ★ ネイティブ RtmpPublisher は「完全 URL（最後のパス要素=stream key）」を要求するため、
//   rtmpUrl + "/" + streamKey を **JS 側で結合** して返す（分離して渡すと native の URL parse が無言で失敗する）。
// ★ サーバーフラグ（NEXT_PUBLIC_BUNNY_LIVE）OFF の間は 503 が返る → null を返し、
//   呼び出し側は従来の LiveKit 経路にフォールバックする（=本番が壊れない・rebuild なしで切替）。
export async function fetchBunnyIngest(
  broadcastId: string,
): Promise<{ rtmpUrl: string; playbackUrl: string; bunnyVideoGuid: string } | null> {
  // 弱電波でボタンが固まらないよう 15 秒でタイムアウト
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${SITE_URL}/api/bunny/live/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ broadcastId }),
      signal: ctrl.signal,
    });
    // 503(フラグOFF) / 5xx / 4xx はすべて null → LiveKit フォールバック
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as {
      rtmpUrl?: string;
      streamKey?: string;
      playbackUrl?: string;
      bunnyVideoGuid?: string;
    };
    if (!json.rtmpUrl || !json.streamKey) return null;
    const fullRtmpUrl = `${json.rtmpUrl.replace(/\/+$/, "")}/${json.streamKey}`;
    return {
      rtmpUrl: fullRtmpUrl,
      playbackUrl: json.playbackUrl ?? "",
      bunnyVideoGuid: json.bunnyVideoGuid ?? "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Bunny LiveStream を停止する（配信終了時・fire-and-forget）。
// 停止し損ねても cron cleanup が残骸を回収する。LiveKit の stopLiveStream と同型。
export async function stopBunnyStream(broadcastId: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${SITE_URL}/api/bunny/live/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ broadcastId }),
      signal: ctrl.signal,
    });
  } catch {
    // fire-and-forget
  } finally {
    clearTimeout(t);
  }
}

// 配信の live_youtube_broadcast_id を DB から読む（live/start の応答が電波で届かなくても
// YouTube IDを確実に取得するため）。live_youtube_broadcast_id はクライアントSELECT可な列。
export async function fetchLiveYoutubeId(
  broadcastId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select("live_youtube_broadcast_id")
    .eq("id", broadcastId)
    .single();
  if (error || !data) return null;
  return (data as { live_youtube_broadcast_id: string | null })
    .live_youtube_broadcast_id;
}

// YouTube同時配信を停止（Egress停止→YouTube enableAutoStopで自動 complete＝アーカイブ化）。
// fire-and-forget。停止し損ねても enableAutoStop でYouTube側は最終的にアーカイブ化されるが、
// Egressが残ると課金が走るので終了経路で確実に呼ぶ。
export async function stopLiveStream(broadcastId: string): Promise<void> {
  // 弱電波で停止UIが固まらないよう 15 秒でタイムアウト（呼び出し側も await しない）
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${SITE_URL}/api/livekit/live/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ broadcastId }),
      signal: ctrl.signal,
    });
  } catch {
    // fire-and-forget（配信本体は別経路で終了済み・Egressはwebhook/cronでも掃除される）
  } finally {
    clearTimeout(t);
  }
}

// ライブ中のスコア / ピリオド更新。share_code で対象行を特定する。
// 渡された項目だけを UPDATE する（部分更新）。
export async function updateScore(
  shareCode: string,
  patch: Partial<{
    home_score: number;
    away_score: number;
    period: string;
    home_sets: number;
    away_sets: number;
    set_results: unknown;
    point_label: string | null;
    // 野球カウント（甲子園風 B/S/O＋走者）
    balls: number;
    strikes: number;
    outs: number;
    runners: { first: boolean; second: boolean; third: boolean };
  }>,
): Promise<void> {
  await supabase.from("broadcasts").update(patch).eq("share_code", shareCode);
}

// 配信終了（status=ended + 終了時刻を ISO-8601 で記録）。share_code で特定。
export async function endBroadcast(shareCode: string): Promise<void> {
  await supabase
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("share_code", shareCode);
}

// この配信者の「まだ live のまま残っている」配信を全て終了させる。
// Web の cleanupStaleBroadcasts の挙動を移植（broadcaster_id + status=live を ended に補正）。
// 異常終了で残ったゴースト配信が新規配信と二重化するのを防ぐ（新規開始前に呼ぶ想定）。
export async function sweepGhostBroadcasts(broadcasterId: string): Promise<void> {
  await supabase
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("broadcaster_id", broadcasterId)
    .eq("status", "live");
}
