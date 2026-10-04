// Gemini API: 画像の生成（Nano Banana Pro）と、できた画像の文字の検品（Gemini Flash）。
// ★APIキーはログに出さない。エラー時もレスポンス本文の message だけを出す。
import fs from "node:fs";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const IMAGE_MODEL = "gemini-3-pro-image"; // Nano Banana Pro
export const CHECK_MODEL = "gemini-3.5-flash";

async function call(env, model, body) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が設定にありません");
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${json?.error?.message ?? "不明なエラー"}`);
  return json;
}

const inline = (file) => ({
  inlineData: { mimeType: "image/png", data: fs.readFileSync(file).toString("base64") },
});

/**
 * 画像を1枚作る。refs = 参考画像（ロゴ・選ばれたデザイン案）のファイルパス。
 * 返り値: { png: Buffer, usage }
 */
export async function generateImage(env, { prompt, refs = [], aspectRatio = "4:5", imageSize = "2K" }) {
  const json = await call(env, IMAGE_MODEL, {
    contents: [{ role: "user", parts: [...refs.map(inline), { text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize } },
  });
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) {
    const reason = json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "画像が返りませんでした";
    throw new Error(`画像生成に失敗: ${reason}`);
  }
  return { png: Buffer.from(part.inlineData.data, "base64"), usage: json.usageMetadata };
}

/**
 * 画像の中に、期待した文字が「そのまま」入っているかを Gemini Flash に読ませて照合する。
 * AI 画像は数字や漢字を間違えることがあるので、投稿前に必ず通す。
 * 返り値: { ok, missing: string[], extraNotes }
 */
export async function checkText(env, pngFile, expected) {
  const json = await call(env, CHECK_MODEL, {
    contents: [
      {
        role: "user",
        parts: [
          inline(pngFile),
          {
            text:
              "この画像に書かれている日本語・英数字をすべて正確に読み取ってください。" +
              "次の各文字列が、一字一句そのまま（誤字・脱字・別の文字への置き換えなし）画像内にあるかを判定してください。\n" +
              expected.map((s, i) => `${i + 1}. ${s}`).join("\n") +
              '\n\nJSON だけで答えてください: {"found":[true/false,...],"all_text":"画像内の全文字","problems":"崩れた文字や意味不明な文字があれば説明、なければ空"}',
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return { ok: false, missing: expected, extraNotes: "検品の応答を読めませんでした" };
  }
  const missing = expected.filter((_, i) => !r.found?.[i]);
  return { ok: missing.length === 0 && !r.problems, missing, extraNotes: r.problems ?? "", allText: r.all_text ?? "" };
}
