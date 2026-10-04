// instagram-bot の共通処理: 設定の読み込み・Supabase・フォント・画像書き出し
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { createClient } from "@supabase/supabase-js";

// 設定ファイル: 既定は ~/.instagram-bot.env（権限600）。開発時は --env <path> で web/.env.local を流用できる。
// ★秘密情報はリポジトリにもログにも書かない（値は表示しない）。
// ~/.instagram-bot.env を土台に、--env の指定ファイルで上書きする（どちらか片方だけでもよい）。
export function loadEnv(argv = process.argv) {
  const i = argv.indexOf("--env");
  const files = [path.join(os.homedir(), ".instagram-bot.env"), i >= 0 ? argv[i + 1] : null].filter(
    (f) => f && fs.existsSync(f)
  );
  if (files.length === 0) throw new Error("設定ファイルがありません（~/.instagram-bot.env）");
  const env = {};
  for (const file of files) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
      const k = line.slice(0, line.indexOf("=")).trim();
      const v = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
      env[k] = v;
    }
  }
  return env;
}

export function getSupabase(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定にありません");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// 画像に使う文字だけを含む Noto Sans JP サブセットを取得（web の opengraph-image.tsx と同じ方式）。
// User-Agent を付けないと Google Fonts は TTF を返す（satori は woff2 を読めない）。
export async function loadFont(text, weight) {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(text)}`
    )
  ).text();
  const m = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!m) throw new Error("フォントの取得に失敗しました");
  return (await fetch(m[1])).arrayBuffer();
}

// satori の要素ツリーから全テキストを集める（フォントのサブセット用）
function collectText(node, out = []) {
  if (node == null || node === false) return out;
  if (typeof node === "string" || typeof node === "number") out.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => collectText(n, out));
  else if (node.props) collectText(node.props.children, out);
  return out;
}

// h("div", {style}, ...children) — JSX を使わずに satori の要素を組み立てる
export function h(type, style, ...children) {
  return { type, props: { style: { display: "flex", ...style }, children: children.flat() } };
}

export async function renderPng(tree, { width, height }) {
  const text = Array.from(new Set(collectText(tree).join("") + "0123456789")).join("");
  const [regular, bold] = await Promise.all([loadFont(text, 500), loadFont(text, 900)]);
  const svg = await satori(tree, {
    width,
    height,
    fonts: [
      { name: "Noto Sans JP", data: regular, weight: 500, style: "normal" },
      { name: "Noto Sans JP", data: bold, weight: 900, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}

// JST の日付ユーティリティ
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export function jstDate(d) {
  return new Date(d.getTime() + JST_OFFSET_MS);
}
export function fmtMd(d) {
  const j = jstDate(d);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}`;
}
