/**
 * 試合タイマー（スコアボードの中に出す「試合の経過時間」）。
 *
 * ★mobile/lib/match-clock.ts と同一内容。web と mobile は別パッケージのため
 *   import で共有できず、やむなく複製している。**片方だけ直さないこと**。
 *
 * ■ 何のためのものか
 * 配信の経過時間（右上の ⏱）とは**別物**。配信者は整列・挨拶から撮り始めるため、
 * 配信時間と試合時間は構造的にずれる。途中から視聴した人が「今何分か」を知るための値。
 *
 * ■ なぜ2つの値で持つのか
 * 毎秒 DB に書くのは論外なので、「動いている区間の開始時刻」と「停止済み区間の累計秒」を
 * 持ち、表示側で計算する。停止中は開始時刻を null にするので、ハーフタイムの長さは加算されない。
 *
 * ■ 既存の経過時間には一切触らない
 * アプリの `elapsed` は**無料トライアル10分の判定にも使われている**
 * （`trialRemainingAtStart - elapsed <= 0`）。そこを差し替えると課金制限が壊れるため、
 * 試合タイマーは独立した値として足す。
 */

export type MatchClock = {
  /** 動いている区間の開始時刻（ISO文字列）。null なら止まっている。 */
  clockStartedAt: string | null | undefined;
  /** 停止済み区間の累計秒。 */
  offsetSeconds: number | null | undefined;
};

/**
 * タイマーが使われているか。
 *
 * ★両方が初期値なら「配信者がタイマーを使っていない」＝**何も表示しない**。
 *   これが後方互換の要。既存配信・過去アーカイブ・他競技は今とまったく同じ見た目になる。
 */
export function hasMatchClock(c: MatchClock): boolean {
  return Boolean(c.clockStartedAt) || (c.offsetSeconds ?? 0) > 0;
}

/** 動作中か（表示の見た目を変えたい場合に使う）。 */
export function isMatchClockRunning(c: MatchClock): boolean {
  return Boolean(c.clockStartedAt);
}

/**
 * 試合の経過秒を返す。タイマー未使用なら null。
 *
 * @param nowMs 「今」の時刻(ms)。★視聴側は**映像の遅延ぶんを引いた値**を渡すこと。
 *   HLS 視聴は映像が 7〜11 秒遅れているため、素の Date.now() を渡すと
 *   スコアだけ合っていて時計だけ先に進む、という一番みっともない状態になる。
 */
export function matchElapsedSeconds(
  c: MatchClock,
  nowMs: number,
): number | null {
  if (!hasMatchClock(c)) return null;
  const offset = Math.max(0, Math.floor(c.offsetSeconds ?? 0));
  if (!c.clockStartedAt) return offset;

  const startMs = new Date(c.clockStartedAt).getTime();
  // 日付が壊れている行で NaN を表示に流さない（0 として扱う）。
  if (!Number.isFinite(startMs)) return offset;

  const running = Math.floor((nowMs - startMs) / 1000);
  return Math.max(0, offset + Math.max(0, running));
}

/**
 * `MM:SS`（1時間を超えたら `H:MM:SS`）。
 * 既存の経過時間表示（formatElapsed）と同じ書式に揃える。
 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ── 配信者が押したときに DB へ書く値 ──────────────────────────────
// 4操作だけで両方の運用に対応できる（決め打ちしない）:
//   通し（DAZN式・後半45:00〜）       … 停止 → 再開
//   後半0分から（少年サッカーで一般的）… 停止 → リセット → 開始

export type MatchClockPatch = {
  match_clock_started_at: string | null;
  match_clock_offset_seconds: number;
};

/** 開始（0 から数え始める） */
export function clockStartPatch(nowMs: number): MatchClockPatch {
  return {
    match_clock_started_at: new Date(nowMs).toISOString(),
    match_clock_offset_seconds: 0,
  };
}

/** 停止（そこまでの秒数を累計に畳み込む） */
export function clockPausePatch(c: MatchClock, nowMs: number): MatchClockPatch {
  return {
    match_clock_started_at: null,
    match_clock_offset_seconds: matchElapsedSeconds(c, nowMs) ?? 0,
  };
}

/** 再開（累計はそのまま、今から再び数える） */
export function clockResumePatch(c: MatchClock, nowMs: number): MatchClockPatch {
  return {
    match_clock_started_at: new Date(nowMs).toISOString(),
    match_clock_offset_seconds: Math.max(0, Math.floor(c.offsetSeconds ?? 0)),
  };
}

/** リセット（未使用の状態に戻す＝表示も消える） */
export function clockResetPatch(): MatchClockPatch {
  return { match_clock_started_at: null, match_clock_offset_seconds: 0 };
}
