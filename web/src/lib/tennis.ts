// ============================================================================
// テニス（硬式）/ ソフトテニス のスコア進行エンジン（純関数）
//
// 設計方針（2026-07-26 設計調査で確定）:
// - ゲーム内ポイント（15/30/40/Ad・タイブレーク・ソフトテニスのカウント）は
//   このエンジンが「表示用文字列」に確定し、broadcasts.game_points (jsonb) へ保存する。
//   視聴側（web/mobile オーバーレイ・アーカイブ SVG）はルールを知らず文字列を描くだけ。
// - セット数 = home_sets/away_sets、現セットのゲーム数 = home_score/away_score を流用
//   （バレー等の既存セット制と同じ列マッピング）。
// - 進行（ポイント→ゲーム→セット→マッチ）は addPoint 1 関数に集約し、
//   ゲーム/セット/マッチの確定はイベントとして返す（呼び出し側が DB へ反映）。
// ============================================================================

export type TennisSide = "home" | "away";

/** 硬式テニスのルールプリセット */
export type HardTennisRule = {
  kind: "hard";
  key: string;
  label: string;
  /** マッチ獲得に必要なセット数（1セットマッチ=1 / 3セットマッチ=2） */
  setsToWin: number;
  /** セット獲得に必要なゲーム数（通常 6。2ゲーム差が必要） */
  gamesPerSet: number;
  /** このゲーム数同士になったらタイブレーク（通常 6-6） */
  tiebreakAt: number;
  /** タイブレークの先取ポイント（通常 7。2ポイント差が必要） */
  tiebreakTo: number;
  /** アドバンテージ制（false = ノーアド: 40-40 の次のポイントで決着） */
  withAd: boolean;
};

/** ソフトテニスのルールプリセット（ゲーム先取制・ファイナルゲームあり） */
export type SoftTennisRule = {
  kind: "soft";
  key: string;
  label: string;
  /** マッチ獲得に必要なゲーム数（5ゲームマッチ=3 / 7ゲームマッチ=4） */
  gamesToWin: number;
  /** ファイナルゲーム（お互いあと1ゲームで到達）の先取ポイント（通常 7。2差） */
  finalGameTo: number;
};

export type TennisRule = HardTennisRule | SoftTennisRule;

/** 競技名（SPORTS 配列・broadcasts.sport の値と一致させる） */
export const SPORT_TENNIS = "テニス";
export const SPORT_SOFT_TENNIS = "ソフトテニス";

export const HARD_TENNIS_RULES: HardTennisRule[] = [
  { kind: "hard", key: "tennis-1set", label: "1セットマッチ（6ゲーム・タイブレーク）", setsToWin: 1, gamesPerSet: 6, tiebreakAt: 6, tiebreakTo: 7, withAd: true },
  { kind: "hard", key: "tennis-3set", label: "3セットマッチ", setsToWin: 2, gamesPerSet: 6, tiebreakAt: 6, tiebreakTo: 7, withAd: true },
  { kind: "hard", key: "tennis-3set-noad", label: "3セットマッチ（ノーアド）", setsToWin: 2, gamesPerSet: 6, tiebreakAt: 6, tiebreakTo: 7, withAd: false },
];

export const SOFT_TENNIS_RULES: SoftTennisRule[] = [
  { kind: "soft", key: "soft-5game", label: "5ゲームマッチ（3ゲーム先取）", gamesToWin: 3, finalGameTo: 7 },
  { kind: "soft", key: "soft-7game", label: "7ゲームマッチ（4ゲーム先取）", gamesToWin: 4, finalGameTo: 7 },
];

export function tennisRulesForSport(sport: string): TennisRule[] | null {
  if (sport === SPORT_TENNIS) return HARD_TENNIS_RULES;
  if (sport === SPORT_SOFT_TENNIS) return SOFT_TENNIS_RULES;
  return null;
}

export function isTennisSport(sport: string): boolean {
  return sport === SPORT_TENNIS || sport === SPORT_SOFT_TENNIS;
}

/** 進行中スナップショット（ポイントは生カウントで保持し、表示時に整形する） */
export type TennisSnapshot = {
  hPts: number;
  aPts: number;
  /** タイブレーク（硬式）/ ファイナルゲーム（ソフトテニス）中か */
  inTiebreak: boolean;
  /** 現セットのゲーム数（broadcasts.home_score/away_score に対応） */
  hGames: number;
  aGames: number;
  /** 獲得セット数（broadcasts.home_sets/away_sets に対応。ソフトテニスでは未使用=0） */
  hSets: number;
  aSets: number;
  /** 確定した各セットのゲームスコア "6-4"（home-away 順。set_results に対応） */
  setResults: string[];
  /** マッチ確定済み（以降 addPoint は no-op） */
  matchWon: TennisSide | null;
};

export function initialTennisSnapshot(): TennisSnapshot {
  return { hPts: 0, aPts: 0, inTiebreak: false, hGames: 0, aGames: 0, hSets: 0, aSets: 0, setResults: [], matchWon: null };
}

export type TennisEvents = {
  gameWon?: TennisSide;
  setWon?: TennisSide;
  matchWon?: TennisSide;
};

/** ソフトテニスがファイナルゲーム条件（例: 7ゲームマッチで 3-3）に入ったか */
function softInFinalGame(rule: SoftTennisRule, hGames: number, aGames: number): boolean {
  return hGames === rule.gamesToWin - 1 && aGames === rule.gamesToWin - 1;
}

/** 現在のゲームが決着したか（生ポイントで判定） */
function gameDecided(rule: TennisRule, s: TennisSnapshot): TennisSide | null {
  const { hPts, aPts, inTiebreak } = s;
  const target = inTiebreak
    ? rule.kind === "hard"
      ? rule.tiebreakTo
      : rule.finalGameTo
    : 4;
  const winBy =
    !s.inTiebreak && rule.kind === "hard" && !rule.withAd
      ? 1 // ノーアド: 40-40 の次のポイントで決着（4 到達＋リードで勝ち）
      : 2;
  if (hPts >= target && hPts - aPts >= winBy) return "home";
  if (aPts >= target && aPts - hPts >= winBy) return "away";
  return null;
}

/**
 * 1 ポイント加算して進行を確定する。ゲーム/セット/マッチの確定はイベントで返す。
 * マッチ確定後は no-op（同じスナップショットを返す）。
 */
export function tennisAddPoint(
  rule: TennisRule,
  s: TennisSnapshot,
  side: TennisSide,
): { next: TennisSnapshot; events: TennisEvents } {
  if (s.matchWon) return { next: s, events: {} };
  const next: TennisSnapshot = { ...s, setResults: [...s.setResults] };
  if (side === "home") next.hPts += 1;
  else next.aPts += 1;

  const events: TennisEvents = {};
  const gameWinner = gameDecided(rule, next);
  if (!gameWinner) return { next, events };

  // --- ゲーム確定 ---
  events.gameWon = gameWinner;
  if (gameWinner === "home") next.hGames += 1;
  else next.aGames += 1;
  next.hPts = 0;
  next.aPts = 0;
  const wasTiebreak = next.inTiebreak;
  next.inTiebreak = false;

  if (rule.kind === "soft") {
    // ソフトテニス: ゲーム先取でマッチ（セット層なし）
    if (softInFinalGame(rule, next.hGames, next.aGames)) next.inTiebreak = true;
    const winnerGames = gameWinner === "home" ? next.hGames : next.aGames;
    if (winnerGames >= rule.gamesToWin) {
      events.matchWon = gameWinner;
      next.matchWon = gameWinner;
      next.setResults.push(`${next.hGames}-${next.aGames}`);
    }
    return { next, events };
  }

  // --- 硬式: セット判定 ---
  const g = gameWinner === "home" ? next.hGames : next.aGames;
  const og = gameWinner === "home" ? next.aGames : next.hGames;
  const setWon =
    (wasTiebreak && g === rule.tiebreakAt + 1) || // 7-6（タイブレーク勝ち）
    (g >= rule.gamesPerSet && g - og >= 2); // 6-4 以下 / 7-5
  if (!setWon) {
    // タイブレーク突入判定（例: 6-6）
    if (next.hGames === rule.tiebreakAt && next.aGames === rule.tiebreakAt) {
      next.inTiebreak = true;
    }
    return { next, events };
  }

  // --- セット確定 ---
  events.setWon = gameWinner;
  next.setResults.push(`${next.hGames}-${next.aGames}`);
  if (gameWinner === "home") next.hSets += 1;
  else next.aSets += 1;
  next.hGames = 0;
  next.aGames = 0;

  const sets = gameWinner === "home" ? next.hSets : next.aSets;
  if (sets >= rule.setsToWin) {
    events.matchWon = gameWinner;
    next.matchWon = gameWinner;
  }
  return { next, events };
}

/**
 * 1 ポイント取り消し（現在のゲーム内のみ・0 が下限）。
 * ゲーム/セット境界を跨ぐ取り消しは対象外＝確定済みゲームの訂正は配信画面の
 * Undo（履歴スタック）で行う。ゲーム数の直接±UI は将来課題（v1.2 候補）。
 */
export function tennisRemovePoint(s: TennisSnapshot, side: TennisSide): TennisSnapshot {
  if (s.matchWon) return s;
  if (side === "home") return { ...s, hPts: Math.max(0, s.hPts - 1) };
  return { ...s, aPts: Math.max(0, s.aPts - 1) };
}

const HARD_PTS = ["0", "15", "30", "40"] as const;

/** broadcasts.game_points に保存する表示用の値（視聴側はこれをそのまま描く） */
export function formatTennisPoints(
  rule: TennisRule,
  s: TennisSnapshot,
): { home: string; away: string; tb?: true } | null {
  if (s.matchWon) return null;
  if (s.inTiebreak || rule.kind === "soft") {
    // タイブレーク／ソフトテニスは素のカウント表示
    const v: { home: string; away: string; tb?: true } = {
      home: String(s.hPts),
      away: String(s.aPts),
    };
    if (s.inTiebreak) v.tb = true;
    return v;
  }
  // 硬式の通常ゲーム: 0/15/30/40/Ad
  const { hPts, aPts } = s;
  if (hPts >= 3 && aPts >= 3) {
    if (hPts === aPts) return { home: "40", away: "40" };
    return hPts > aPts ? { home: "Ad", away: "40" } : { home: "40", away: "Ad" };
  }
  return { home: HARD_PTS[Math.min(hPts, 3)], away: HARD_PTS[Math.min(aPts, 3)] };
}

/**
 * point_label（バッジ）: タイブレーク/ファイナルゲーム表示と、
 * 「次の 1 ポイントでセット/マッチが決まる」状況の表示。
 */
export function tennisPointLabel(rule: TennisRule, s: TennisSnapshot): string | null {
  if (s.matchWon) return null;
  const stake = (side: TennisSide): "match" | "set" | null => {
    const { events } = tennisAddPoint(rule, s, side);
    if (events.matchWon) return "match";
    if (events.setWon) return "set";
    return null;
  };
  const h = stake("home");
  const a = stake("away");
  if (h === "match" || a === "match") return "マッチポイント";
  if (h === "set" || a === "set") return "セットポイント";
  if (s.inTiebreak) return rule.kind === "soft" ? "ファイナルゲーム" : "タイブレーク";
  return null;
}
