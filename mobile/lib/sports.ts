// 競技ごとのピリオド／セットのルールを集約した純粋ロジック。
// Web 版（web/src/app/broadcast/page.tsx）の SPORTS / PERIODS / 野球イニング生成 /
// バレーのセット進行ロジックをそのまま React Native 用に移植したもの。
//
// 制約: 純 TypeScript（React / Supabase / DOM 一切なし）。RN で動く。
// DB カラムは broadcasts テーブルの home_sets / away_sets / set_results に対応する。

/** 配信フォームで選べる競技キー */
export type SportKey =
  | "soccer"
  | "baseball"
  | "basketball"
  | "volleyball"
  | "badminton"
  | "table_tennis"
  | "track"
  | "other";

/**
 * 競技の選択肢。label は Web 版 `SPORTS` 配列の日本語表記と完全一致させる
 * （サッカー / 野球 / バスケ / バレー / 陸上 / その他）。
 * broadcasts.sport にはこの label（日本語文字列）を保存する＝Web と同じ値。
 */
export const SPORTS: { key: SportKey; label: string }[] = [
  { key: "soccer", label: "サッカー" },
  { key: "baseball", label: "野球" },
  { key: "basketball", label: "バスケ" },
  { key: "volleyball", label: "バレー" },
  { key: "badminton", label: "バドミントン" },
  { key: "table_tennis", label: "卓球" },
  { key: "track", label: "陸上" },
  { key: "other", label: "その他" },
];

/** SportKey → 日本語ラベル（broadcasts.sport に保存する値）を引く */
export function sportLabel(sport: SportKey): string {
  return SPORTS.find((s) => s.key === sport)?.label ?? "その他";
}

/** 日本語ラベル（Web/DB の sport 値）→ SportKey を引く。未知は "other" */
export function sportKeyFromLabel(label: string): SportKey {
  return SPORTS.find((s) => s.label === label)?.key ?? "other";
}

/**
 * 野球のイニング表記を生成する（Web 版 generateBaseballPeriods と同一）。
 * 1回表 / 1回裏 / … / N回表 / N回裏 / 延長 の順。
 * Web のデフォルト（高校以上＝9回）に合わせて innings=9 を既定にする。
 */
function generateBaseballPeriods(innings: number): string[] {
  const periods: string[] = [];
  for (let i = 1; i <= innings; i++) {
    periods.push(`${i}回表`, `${i}回裏`);
  }
  periods.push("延長");
  return periods;
}

/**
 * 非セット競技のピリオド表。Web 版 `PERIODS` と一致させる。
 * （バレー＝セット制 / 野球＝イニング生成 はここには含めない）
 */
const PERIODS: Record<
  Exclude<SportKey, "volleyball" | "baseball" | "badminton" | "table_tennis">,
  string[]
> = {
  soccer: ["前半", "後半", "延長"],
  basketball: ["1Q", "2Q", "3Q", "4Q", "OT"],
  track: ["競技中"],
  other: ["前半", "後半", "延長"],
};

/**
 * セット/ゲーム制競技の「単位」ラベル。
 * バレー＝セット、バドミントン/卓球＝ゲーム。
 */
export function setUnitLabel(sport: SportKey): string {
  if (sport === "badminton" || sport === "table_tennis") return "ゲーム";
  return "セット"; // volleyball
}

/**
 * セット/ゲーム制のピリオド表記を作る（例: "1セット" / "3ゲーム"）。
 * 第何セット/ゲームかは「獲得セット合計 + 1」で動的に決まるため、
 * 固定長の配列ではなく番号から生成する（5セットや7ゲームでも破綻しない）。
 *
 * 参考ルール（手動進行のため点数の自動判定はしない・配信者が「次へ」を押す）:
 *  - バレー: 25点/最終セット15点・2点差（6人制）
 *  - バドミントン: 21点・2点差・最大30点 / 3ゲームマッチ
 *  - 卓球: 11点・2点差 / 5ゲームマッチ
 */
export function periodLabelForSet(sport: SportKey, gameNumber: number): string {
  return `${gameNumber}${setUnitLabel(sport)}`;
}

/**
 * 競技の順序付きピリオドラベル配列を返す。
 * - サッカー / バスケ / 陸上 / その他 … PERIODS の固定表
 * - 野球 … 9回ぶんのイニング表記 + 延長
 * - バレー … セット表記（既定 3 セット）
 * Web 版 broadcast/page.tsx の `periods` 算出ロジックと同じ結果になる。
 */
export function periodsFor(sport: SportKey): string[] {
  if (isSetBased(sport)) return [periodLabelForSet(sport, 1)];
  if (sport === "baseball") return generateBaseballPeriods(9);
  return [...PERIODS[sport]];
}

/**
 * 現在のピリオドラベルから「次のピリオド」を返す（periodsFor を循環）。
 * 末尾まで来たら先頭に戻る。current が一覧に無ければ先頭を返す。
 */
export function nextPeriod(sport: SportKey, current: string): string {
  const list = periodsFor(sport);
  if (list.length === 0) return current;
  const idx = list.indexOf(current);
  if (idx === -1) return list[0];
  return list[(idx + 1) % list.length];
}

/** セット/ゲーム制の競技か（バレー/バドミントン/卓球で true） */
export function isSetBased(
  sport: SportKey,
): sport is "volleyball" | "badminton" | "table_tennis" {
  return (
    sport === "volleyball" ||
    sport === "badminton" ||
    sport === "table_tennis"
  );
}

/**
 * バレーのセット状態。DB カラム home_sets / away_sets / set_results に対応する。
 * set_results は各セット終了時の {home, away} 得点履歴（配列）。
 */
export type SetState = {
  /** broadcasts.home_sets … ホームの獲得セット数 */
  homeSets: number;
  /** broadcasts.away_sets … アウェイの獲得セット数 */
  awaySets: number;
  /** broadcasts.set_results … 各セットの最終得点履歴 */
  setResults: { home: number; away: number }[];
};

/** セット状態の初期値（0-0、履歴なし） */
export function emptySetState(): SetState {
  return { homeSets: 0, awaySets: 0, setResults: [] };
}

/**
 * セットを 1 つ進める（Web 版「次へ 0-0」ボタンのロジックを移植）。
 * - 現在のセット得点 {homeScore, awayScore} を set_results に追記
 * - 得点が高い方のセット獲得数を +1（同点ならどちらも増やさない）
 * - 戻り値の nextScore は次セット開始の 0-0（呼び出し側で point score をリセット）
 *
 * 注意: ピリオド（セットラベル）の前進は呼び出し側で nextPeriod / clamp する。
 * Web も periodIndex を別途 Math.min で進めているため、ここでは set 集計のみ担う。
 */
export function advanceSet(
  state: SetState,
  homeScore: number,
  awayScore: number,
): { state: SetState; nextScore: { home: number; away: number } } {
  const setResults = [...state.setResults, { home: homeScore, away: awayScore }];
  let homeSets = state.homeSets;
  let awaySets = state.awaySets;
  // スコアが高い方が勝ち（Web と同じく同点時はどちらも加算しない）
  if (homeScore > awayScore) {
    homeSets = state.homeSets + 1;
  } else if (awayScore > homeScore) {
    awaySets = state.awaySets + 1;
  }
  return {
    state: { homeSets, awaySets, setResults },
    nextScore: { home: 0, away: 0 },
  };
}

/**
 * 現在のセット状況を表示用文字列に整形する。
 * 例: 「セット 2-1」。セットがまだ無い場合は「セット 0-0」。
 * 直近セットの得点履歴があれば末尾に付記する（例: 「セット 2-1（25-23）」）。
 */
export function formatSetState(state: SetState): string {
  const base = `セット ${state.homeSets}-${state.awaySets}`;
  const last = state.setResults[state.setResults.length - 1];
  if (!last) return base;
  return `${base}（${last.home}-${last.away}）`;
}

// ============================================================================
// 競技のルール種別（バレー＝小学生/6人制/9人制、野球＝カテゴリ別イニング）
// Web 版 broadcast/page.tsx の VOLLEYBALL_RULES / BASEBALL_RULES を完全移植。
// ※ ルール種別は broadcasts に保存しない（配信者側のピリオド/ポイント表示のみに影響）。
// ============================================================================

/** バレーのルール（セット先取数・通常セット点・最終セット点） */
export type VolleyballRule = {
  setsToWin: number;
  setPoint: number;
  finalSetPoint: number;
};

/** バレーのルール種別。Web VOLLEYBALL_RULES と一致。 */
export const VOLLEYBALL_RULES: Record<string, VolleyballRule> = {
  小学生6人制: { setsToWin: 2, setPoint: 21, finalSetPoint: 15 },
  "6人制": { setsToWin: 3, setPoint: 25, finalSetPoint: 15 },
  "9人制": { setsToWin: 2, setPoint: 21, finalSetPoint: 21 },
};
export const VOLLEYBALL_RULE_NAMES = Object.keys(VOLLEYBALL_RULES);
export const DEFAULT_VOLLEYBALL_RULE = "6人制";

/** 野球のルール種別（イニング数）。Web BASEBALL_RULES と一致。 */
export const BASEBALL_RULES: Record<string, { innings: number }> = {
  "学童（5回）": { innings: 5 },
  "学童（6回）": { innings: 6 },
  "中学（7回）": { innings: 7 },
  "高校以上（9回）": { innings: 9 },
};
export const BASEBALL_RULE_NAMES = Object.keys(BASEBALL_RULES);
export const DEFAULT_BASEBALL_RULE = "高校以上（9回）";

/** 野球: 選択ルールのイニング数からピリオド配列（1回表/裏…N回裏/延長）を生成 */
export function baseballPeriods(ruleName: string): string[] {
  const rule = BASEBALL_RULES[ruleName];
  return generateBaseballPeriods(rule ? rule.innings : 9);
}

/** 与えられたピリオド配列を循環して「次のピリオド」を返す（ルール可変の野球用） */
export function nextPeriodIn(periods: string[], current: string): string {
  if (periods.length === 0) return current;
  const idx = periods.indexOf(current);
  if (idx === -1) return periods[0];
  return periods[(idx + 1) % periods.length];
}

/** バレールールの説明（例: "3セットマッチ / 25点制 / 最終15点"） */
export function volleyballRuleLabel(ruleName: string): string {
  const r = VOLLEYBALL_RULES[ruleName];
  if (!r) return "";
  return `${r.setsToWin * 2 - 1}セットマッチ / ${r.setPoint}点制 / 最終${r.finalSetPoint}点`;
}

/**
 * バレーのセットポイント/マッチポイント判定（Web getPointLabel を完全移植）。
 * - 最終セットかどうかで規定点（setPoint / finalSetPoint）を切替
 * - 規定点-1 以上 かつ 相手リードで「セットポイント」
 * - さらに このセットを取れば試合勝利（sets >= setsToWin-1）なら「マッチポイント」
 */
export function volleyballPointLabel(
  ruleName: string,
  homeSets: number,
  awaySets: number,
  homeScore: number,
  awayScore: number,
): "マッチポイント" | "セットポイント" | null {
  const rule = VOLLEYBALL_RULES[ruleName];
  if (!rule) return null;
  const label = setSportPointLabel("volleyball", rule, homeSets, awaySets, homeScore, awayScore);
  return label as "マッチポイント" | "セットポイント" | null;
}

// バドミントン/卓球の既定ルール（v1はルール選択なし＝既定値）。VolleyballRule と同型。
// バドミントン: 3ゲームマッチ(2先取)・21点。卓球: 5ゲームマッチ(3先取)・11点。
const BADMINTON_RULE: VolleyballRule = { setsToWin: 2, setPoint: 21, finalSetPoint: 21 };
const TABLE_TENNIS_RULE: VolleyballRule = { setsToWin: 3, setPoint: 11, finalSetPoint: 11 };

/** セット/ゲーム制の競技に対応するルールを返す（バレーは選択ルール名、バド/卓球は既定）。 */
export function setSportRule(
  sport: SportKey,
  volleyballRuleName: string,
): VolleyballRule | null {
  if (sport === "volleyball") return VOLLEYBALL_RULES[volleyballRuleName] ?? null;
  if (sport === "badminton") return BADMINTON_RULE;
  if (sport === "table_tennis") return TABLE_TENNIS_RULE;
  return null;
}

/**
 * セット/ゲーム制の「セット(ゲーム)ポイント / マッチポイント」判定（バレー/バド/卓球 共通）。
 * 表示語はバレー=「セットポイント」、バド/卓球=「ゲームポイント」。
 */
export function setSportPointLabel(
  sport: SportKey,
  rule: VolleyballRule,
  homeSets: number,
  awaySets: number,
  homeScore: number,
  awayScore: number,
): "マッチポイント" | "セットポイント" | "ゲームポイント" | null {
  const { setsToWin, setPoint, finalSetPoint } = rule;
  const isFinalSet = homeSets + awaySets >= setsToWin * 2 - 2;
  const targetScore = isFinalSet ? finalSetPoint : setPoint;
  const homeAt = homeScore >= targetScore - 1 && homeScore > awayScore;
  const awayAt = awayScore >= targetScore - 1 && awayScore > homeScore;
  if (!homeAt && !awayAt) return null;
  if ((homeAt && homeSets >= setsToWin - 1) || (awayAt && awaySets >= setsToWin - 1)) {
    return "マッチポイント";
  }
  return sport === "volleyball" ? "セットポイント" : "ゲームポイント";
}
