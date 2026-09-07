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

// ===== 自前配信サーバー（MediaMTX on VPS）=====

// 配信ごとの配信先（完全 RTMP URL・publish認証付）＋ HLS 視聴 URL を取得する。
// サーバー（/api/stream/provision）が rtmp://<host>/<shareCode>?user=&pass=<SECRET> を組んで返す。
// ★ これは**完全URL**なので、そのまま RtmpPublisher.streamUrl に渡す（結合不要）。
// ★ サーバーフラグ（NEXT_PUBLIC_STREAM_SELFHOST）OFF の間は 503 が返る → null を返し、
//   呼び出し側は従来の LiveKit 経路にフォールバックする（=本番が壊れない・rebuild なしで切替）。
// ※ 配信終了時の「停止API」は不要：publish が切れると MediaMTX が自動でパスを破棄する
//   （broadcasts の status=ended は endBroadcast 側で記録）。
export async function fetchStreamTarget(
  broadcastId: string,
): Promise<{
  rtmpUrl: string;
  playbackUrl: string;
  // 配信前の映像チェックの厳格度。サーバーが返さなければ undefined（＝呼び出し側で "warn"）。
  // ★サーバー側だけで無効化/強化できるようにするための受け口。現時点でサーバーは
  //   このフィールドを返さないが、返し始めたら**アプリを出し直さずに**効く。
  preflight?: "off" | "warn" | "block";
} | null> {
  // 弱4Gでも自前配信(provision)を取りに行く猶予を確保（短いとLiveKit旧経路に落ちる）。
  // ボタンが固まらないよう 30 秒で打ち切り。
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${SITE_URL}/api/stream/provision`, {
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
      playbackUrl?: string;
      preflight?: string;
    };
    if (!json.rtmpUrl) return null;
    // 知らない値が来たら黙って無視する（＝呼び出し側の既定 "warn" になる）。
    const preflight =
      json.preflight === "off" ||
      json.preflight === "warn" ||
      json.preflight === "block"
        ? json.preflight
        : undefined;
    return {
      rtmpUrl: json.rtmpUrl,
      playbackUrl: json.playbackUrl ?? "",
      preflight,
    };
  } catch {
    return null;
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
    // 試合タイマー（スコアボード内）。既存の経過時間とは別物。
    match_clock_started_at: string | null;
    match_clock_offset_seconds: number;
    // テニス系のゲーム内ポイント（表示用文字列。ゲーム間/非テニスは null）
    game_points: { home: string; away: string; tb?: true } | null;
    // 野球カウント（甲子園風 B/S/O＋走者）
    balls: number;
    strikes: number;
    outs: number;
    runners: { first: boolean; second: boolean; third: boolean };
  }>,
): Promise<void> {
  await supabase.from("broadcasts").update(patch).eq("share_code", shareCode);
}

// 現在のお知らせテロップを読む。配信中に画面が再マウントされても（画面ロック復帰の
// LiveKit 作り直し等）配信者UIの状態をDBの実態に合わせるために使う。
// これが無いと「お知らせを消す」が消えて視聴者側に出しっぱなしになる事故が起きる。
export async function getBroadcastNotice(
  shareCode: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select("notice")
    .eq("share_code", shareCode)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { notice: string | null }).notice ?? null;
}

// 現在の試合タイマーを読む。getBroadcastNotice と同じ理由で必要。
// 画面ロック復帰などで配信UIが作り直されてもローカル state が初期値に戻らないようにする。
// これが無いと「視聴者には時計が動いているのに配信者の画面だけ 00:00」になり、
// 配信者が「壊れた」と思ってリセットを押してしまう。
export async function getBroadcastMatchClock(shareCode: string): Promise<{
  match_clock_started_at: string | null;
  match_clock_offset_seconds: number;
} | null> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select("match_clock_started_at, match_clock_offset_seconds")
    .eq("share_code", shareCode)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as {
    match_clock_started_at: string | null;
    match_clock_offset_seconds: number | null;
  };
  return {
    match_clock_started_at: d.match_clock_started_at ?? null,
    match_clock_offset_seconds: d.match_clock_offset_seconds ?? 0,
  };
}

// 配信者から視聴者へのお知らせテロップを更新（null で非表示に戻す）。
// Web 版 updateBroadcastNotice（web/src/lib/database.ts）と同じ contract。
// 書き込みは既存 RLS（配信者本人のみ更新可）+ 列レベル GRANT UPDATE (notice) で保護される
// ため、ここでの追加ガードは不要。視聴側へは broadcasts の Realtime UPDATE で届く。
export async function updateBroadcastNotice(
  shareCode: string,
  notice: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from("broadcasts")
    .update({ notice })
    .eq("share_code", shareCode);
  if (error) {
    console.error("お知らせ更新エラー:", error.message);
    return false;
  }
  return true;
}

// 配信終了（status=ended + 終了時刻を ISO-8601 で記録）。share_code で特定。
export async function endBroadcast(shareCode: string): Promise<void> {
  await supabase
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("share_code", shareCode);
}

// ③ サーバー側スコア焼き込み用: スコア変更時に「時刻付き」でスコア行を記録（配信中のみ）。
// アーカイブワーカー(VPS)がこの時系列で録画に ffmpeg(ASS字幕)でスコアを焼き込む。
// fire-and-forget（記録に失敗しても配信は止めない）。
export async function insertScoreEvent(
  broadcastId: string,
  fields: {
    scoreboard_text: string;
    home_score: number;
    away_score: number;
    home_sets: number;
    away_sets: number;
    period: string;
  },
): Promise<void> {
  await supabase
    .from("broadcast_score_events")
    .insert({ broadcast_id: broadcastId, ...fields });
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
