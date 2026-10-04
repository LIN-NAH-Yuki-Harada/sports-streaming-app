// カルーセル（表紙＋中身＋最後の呼びかけ）を、選ばれたデザイン案の雰囲気で作る。
//   node carousel.mjs <台本.json>   … out/carousel/<id>/ に 1080x1350 の PNG を枚数分書き出す
// 流れ: Nano Banana Pro で1枚ずつ生成 → Gemini Flash で文字検品（最大3回作り直し）→ 本物のロゴを右下に重ねる
// ★ロゴとブランド名は AI に描かせない（3案とも「SPOtCH」が崩れたため）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, h, renderPng } from "./lib.mjs";
import { generateImage, checkText, sniffMime } from "./gemini.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.resolve(here, "../../mobile/assets/icon.png");
const STYLE_REF = path.join(here, "brand", "style-reference.png");
const MAX_TRIES = 3;

const RULES = `
厳守事項:
- 添付画像はデザインの見本。色・光・文字の太さ・テロップの帯など、雰囲気をそろえる（同じ絵の複製ではなく、内容に合わせた新しい構図）
- 人物（子ども・大人・選手・観客）を一切描かない。顔・手・人影・シルエットも描かない
- 実在のチーム名・学校名・ロゴ・ユニフォームを描かない
- ロゴマークやブランド名（LIVE SPOtCH）は描かない。右下の角（横25%×縦12%）には文字・図形・白い四角などを置かず、背景の写真がそのまま続くようにする（後で本物のロゴを重ねる）
- 画像内の文字は下に指定したものだけ。一字一句そのとおりに、大きく読みやすく正確に書く。指定以外の文字を足さない
- Instagram のカルーセル（縦4:5）。スマホで見て一瞬で内容が分かる構図`;

function slidePrompt(slide, i, total) {
  const texts = slide.texts.map((t) => `「${t}」`).join("\n");
  return `LIVE SPOtCH（スマホで子どもの試合をライブ配信するサービス）の Instagram カルーセル ${i + 1}/${total} 枚目。
役割: ${slide.role}
絵の内容: ${slide.visual}
画像内に書く文字（これだけ）:
${texts}
${RULES}`;
}

// 本物のロゴ＋ブランド名を右下に重ねて 1080x1350 にする
async function overlayBrand(aiPng) {
  const bg = `data:${sniffMime(aiPng)};base64,${aiPng.toString("base64")}`;
  const logo = `data:image/png;base64,${fs.readFileSync(LOGO).toString("base64")}`;
  const tree = h(
    "div",
    { width: 1080, height: 1350, position: "relative", fontFamily: "Noto Sans JP" },
    { type: "img", props: { src: bg, width: 1080, height: 1350, style: { position: "absolute", top: 0, left: 0 } } },
    h(
      "div",
      {
        position: "absolute",
        right: 28,
        bottom: 28,
        alignItems: "center",
        padding: "10px 18px 10px 12px",
        borderRadius: 18,
        background: "rgba(0,0,0,0.45)", // 明るい背景（体育館など）でも白い文字が読めるように
      },
      { type: "img", props: { src: logo, width: 64, height: 64, style: { borderRadius: 14 } } },
      h("div", { marginLeft: 14, fontSize: 30, fontWeight: 900, color: "#ffffff", letterSpacing: 1 }, "LIVE SPOtCH")
    )
  );
  return renderPng(tree, { width: 1080, height: 1350 });
}

async function main() {
  const scriptFile = process.argv[2];
  if (!scriptFile || !fs.existsSync(scriptFile)) throw new Error("台本の JSON を指定してください");
  if (!fs.existsSync(STYLE_REF)) throw new Error(`デザインの見本がありません: ${STYLE_REF}`);
  const script = JSON.parse(fs.readFileSync(scriptFile, "utf8"));
  const env = loadEnv();
  const outDir = path.join(here, "out", "carousel", script.id);
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];

  // --overlay-only: 生成済みの raw を使ってロゴ重ねだけやり直す（費用ゼロ）
  if (process.argv.includes("--overlay-only")) {
    for (const [i] of script.slides.entries()) {
      const n = String(i + 1).padStart(2, "0");
      fs.writeFileSync(path.join(outDir, `${n}.png`), await overlayBrand(fs.readFileSync(path.join(outDir, `${n}.raw.png`))));
    }
    console.log("[carousel] ロゴ重ねをやり直しました");
    return;
  }

  const onlyArg = process.argv.find((a) => a.startsWith("--slides="));
  const only = onlyArg ? onlyArg.split("=")[1].split(",").map(Number) : null;

  for (const [i, slide] of script.slides.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const rawFile = path.join(outDir, `${n}.raw.png`);
    if (only && !only.includes(i + 1)) {
      // 作り直さない枚は、生成済みの raw にロゴを重ね直すだけ
      fs.writeFileSync(path.join(outDir, `${n}.png`), await overlayBrand(fs.readFileSync(rawFile)));
      report.push({ slide: n, ok: true, missing: [], notes: "前回の生成を再利用" });
      continue;
    }
    let check = null;
    for (let t = 1; t <= MAX_TRIES; t++) {
      const { png } = await generateImage(env, {
        prompt: slidePrompt(slide, i, script.slides.length),
        refs: [STYLE_REF],
      });
      fs.writeFileSync(rawFile, png);
      check = await checkText(env, rawFile, slide.texts);
      console.log(`[carousel] ${n} 試行${t}: ${check.ok ? "合格" : `不合格 ${check.missing.join(" / ") || check.extraNotes}`}`);
      if (check.ok) break;
    }
    fs.writeFileSync(path.join(outDir, `${n}.png`), await overlayBrand(fs.readFileSync(rawFile)));
    report.push({ slide: n, ok: check.ok, missing: check.missing, notes: check.extraNotes });
  }
  fs.writeFileSync(path.join(outDir, "caption.txt"), script.caption);
  fs.writeFileSync(path.join(outDir, "check-report.json"), JSON.stringify(report, null, 2));
  const ng = report.filter((r) => !r.ok);
  console.log(`[carousel] 完了: ${report.length}枚中 合格${report.length - ng.length}枚${ng.length ? `（要確認: ${ng.map((r) => r.slide).join(",")}）` : ""}`);
}

main().catch((e) => {
  console.error("[carousel] 失敗:", e.message);
  process.exit(1);
});
