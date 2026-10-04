// デザインの方向性を決めるための3案を作る（最初に1回だけ使う）。
//   node styles.mjs            … out/styles/ に A/B/C の3枚と検品結果を書き出す
// オーナーが選んだ1枚を、以後の投稿の「参考画像」として毎回 Nano Banana Pro に渡す。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib.mjs";
import { generateImage, checkText } from "./gemini.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.resolve(here, "../../mobile/assets/icon.png");

// 3案とも同じお題（お役立ちカルーセルの表紙）で比べる
const TITLE = "子どもの試合をスマホで撮る5つのコツ";
const SUB = "保存して、次の試合で使おう";
const BRAND = "LIVE SPOtCH";

// 全案共通の守る線
const RULES = `
厳守事項:
- 人物（子ども・大人・選手・観客）を一切描かない。顔・手・人影・シルエットも描かない
- 実在のチーム名・学校名・ロゴ・ユニフォームを描かない
- 画像内の文字は次の3つだけ。一字一句このとおりに、読みやすく大きく正確に書く:
  見出し「${TITLE}」
  小見出し「${SUB}」
  ブランド名「${BRAND}」（添付のロゴマークの横に小さく）
- 添付画像は LIVE SPOtCH のロゴマーク（赤地に白のS）。形を変えずに小さく配置する
- Instagram のフィード用カルーセル1枚目（縦4:5）。スマホで見て一瞬で内容が分かる構図
- 対象は部活・スポーツ少年団の子どもを持つ30〜40代の保護者`;

const STYLES = {
  A: `デザイン方向: TV スポーツ中継のグラフィック風。濃い紺色の背景、白い太字、赤はアクセントだけ。
画面下部に中継テロップのような帯、上部に小さな「LIVE」バッジ。三脚に固定したスマートフォンが、
夕方のグラウンドを横向きで撮影している情景を、背景に暗めにぼかして入れる。洗練された放送局の品質。`,
  B: `デザイン方向: やわらかいフラットイラスト風。明るいクリーム色の背景、丸みのある線、温かい配色（赤はアクセント）。
三脚に乗ったスマートフォン、サッカーボール・野球ボール・バレーボール、ストップウォッチなどの小物を、
可愛くかつ大人っぽくレイアウト。手書き風ではなく、整ったベクターイラスト。子育て世代に親しみやすい雰囲気。`,
  C: `デザイン方向: 写真風の背景＋大きな文字の雑誌の表紙風。誰もいない体育館（またはナイター照明の人工芝グラウンド）を、
観客席から三脚のスマートフォン越しに見た写真のような背景。浅い被写界深度で背景はやわらかくぼかす。
文字は白の極太で、読みやすさのため背景の上に半透明の暗い帯を敷く。上質なスポーツ雑誌の表紙のような高級感。`,
};

async function main() {
  const env = loadEnv();
  const outDir = path.join(here, "out", "styles");
  fs.mkdirSync(outDir, { recursive: true });
  const only = process.argv.find((a) => /^--only=/.test(a))?.split("=")[1];

  for (const [key, style] of Object.entries(STYLES)) {
    if (only && !only.includes(key)) continue;
    const file = path.join(outDir, `style-${key}.png`);
    try {
      const { png } = await generateImage(env, { prompt: `${style}\n${RULES}`, refs: [LOGO] });
      fs.writeFileSync(file, png);
      const check = await checkText(env, file, [TITLE, SUB, BRAND]);
      fs.writeFileSync(path.join(outDir, `style-${key}.check.json`), JSON.stringify(check, null, 2));
      console.log(`[styles] ${key}: 生成OK / 文字検品 ${check.ok ? "合格" : `不合格 (${check.missing.join(" / ") || check.extraNotes})`}`);
    } catch (e) {
      console.error(`[styles] ${key}: 失敗 ${e.message}`);
    }
  }
}

main();
