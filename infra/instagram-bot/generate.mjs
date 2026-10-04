// 投稿の下書きを作る（Mac の launchd から毎日起動する想定）。
//   node generate.mjs --dry                 … out/ に画像と投稿文を書き出すだけ（DB・Instagram には何もしない）
//   node generate.mjs --dry --env <path>    … 設定ファイルを指定（開発時は web/.env.local を読み取り専用で流用）
// 承認キュー（instagram_posts）への登録と公開は次の段階で追加する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, getSupabase, JST_OFFSET_MS } from "./lib.mjs";
import { lastCompletedWeek, fetchWeeklyStats, renderWeekly, weeklyCaption } from "./weekly.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dry = process.argv.includes("--dry");

async function main() {
  if (!dry) throw new Error("いまは --dry のみ対応しています（承認キューは次の段階で追加）");
  const sb = getSupabase(loadEnv());
  const week = lastCompletedWeek();
  const stats = await fetchWeeklyStats(sb, week);
  const png = await renderWeekly(stats);
  const caption = weeklyCaption(stats);

  const outDir = path.join(here, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const base = `weekly-${new Date(week.from.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)}`;
  fs.writeFileSync(path.join(outDir, `${base}.png`), png);
  fs.writeFileSync(path.join(outDir, `${base}.txt`), caption);
  console.log(`[generate] ${base}: ${stats.games}試合 / ${stats.hours}時間 / 大会${stats.tournaments}件`);
  console.log(`[generate] 書き出し: out/${base}.png, out/${base}.txt`);
}

main().catch((e) => {
  console.error("[generate] 失敗:", e.message);
  process.exit(1);
});
