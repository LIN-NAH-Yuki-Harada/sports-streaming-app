// ライブの ViewerScoreboardOverlay（左上・色分けスコアボード）を SVG で再現する。
// worker がスコアイベント毎にこれを生成→PNG(rsvg-convert)→ffmpegで録画に焼き込む。
// 内容が長い場合（長いチーム名＋セット＋競技別extra等）は画面幅に収まるよう自動縮小する。
"use strict";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// テキスト幅の概算（全角≈fs / 半角≈fs*0.55）。SVGは自動レイアウトが無いため必要。
function estWidth(s, fs) {
  let w = 0;
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0);
    w += c > 0x2e7f && !(c >= 0xff61 && c <= 0xff9f) ? fs : fs * 0.55;
  }
  return w;
}

// data: { homeTeam, awayTeam, homeScore, awayScore, homeSets, awaySets, period, extra }
// extra = 競技別の追加情報（野球=B/S/O、バレー=セットポイント等）。
function buildScoreboardSvg(data, opts = {}) {
  const W = opts.width || 1280;
  const H = opts.height || 720;
  const x0 = 24;
  const y0 = 20;
  const r = 8;
  const gapSets = 8;
  const maxW = W - x0 * 2; // この幅に収める

  const homeTeam = String(data.homeTeam || "HOME");
  const awayTeam = String(data.awayTeam || "AWAY");
  const scoreText = `${data.homeScore ?? 0} - ${data.awayScore ?? 0}`;
  const period = data.period ? String(data.period) : "";
  const extra = data.extra ? String(data.extra) : "";
  const showSets =
    (Number(data.homeSets) || 0) > 0 || (Number(data.awaySets) || 0) > 0;
  const homeSets = String(data.homeSets ?? 0);
  const awaySets = String(data.awaySets ?? 0);

  // 幅は (fs, padX) にほぼ線形。base で総幅を出し、maxW に収まるよう一律スケール。
  const widthAt = (fs, padX) => {
    const setW = showSets ? estWidth("0", fs) + gapSets : 0;
    const wHome = estWidth(homeTeam, fs) + setW + padX * 2;
    const wScore = estWidth(scoreText, fs) + padX * 2;
    const wAway = estWidth(awayTeam, fs) + setW + padX * 2;
    const wPeriod = period ? estWidth(period, fs) + padX * 2 : 0;
    const wExtra = extra ? estWidth(extra, fs) + padX * 2 : 0;
    return {
      setW,
      wHome,
      wScore,
      wAway,
      wPeriod,
      wExtra,
      total: wHome + wScore + wAway + wPeriod + wExtra,
    };
  };

  const baseFs = 30;
  const basePadX = 16;
  const basePadY = 11;
  const base = widthAt(baseFs, basePadX);
  // 1.06 はフォント実寸が概算より広いことへの安全マージン（はみ出し防止）。
  const scale = Math.min(1, maxW / (base.total * 1.06));
  const fs = baseFs * scale;
  const padX = basePadX * scale;
  const padY = basePadY * scale;
  const { setW, wHome, wScore, wAway, wPeriod, wExtra, total: totalW } =
    widthAt(fs, padX);
  const h = fs + padY * 2;
  const midY = y0 + h / 2;

  const parts = [];
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${totalW}" height="${h}" rx="${r}" ry="${r}" fill="#000000" fill-opacity="0.82"/>`,
  );

  const clipId = "sbclip";
  parts.push(
    `<clipPath id="${clipId}"><rect x="${x0}" y="${y0}" width="${totalW}" height="${h}" rx="${r}" ry="${r}"/></clipPath>`,
  );
  const seg = [];
  const x = x0;
  seg.push(`<rect x="${x}" y="${y0}" width="${wHome}" height="${h}" fill="#ffffff" fill-opacity="0.10"/>`);
  seg.push(`<rect x="${x + wHome}" y="${y0}" width="${wScore}" height="${h}" fill="#e63946"/>`);
  seg.push(`<rect x="${x + wHome + wScore}" y="${y0}" width="${wAway}" height="${h}" fill="#ffffff" fill-opacity="0.10"/>`);
  if (period) seg.push(`<rect x="${x + wHome + wScore + wAway}" y="${y0}" width="${wPeriod}" height="${h}" fill="#000000" fill-opacity="0.35"/>`);
  if (extra) seg.push(`<rect x="${x + wHome + wScore + wAway + wPeriod}" y="${y0}" width="${wExtra}" height="${h}" fill="#000000" fill-opacity="0.55"/>`);
  parts.push(`<g clip-path="url(#${clipId})">${seg.join("")}</g>`);

  const T = (tx, anchor, txt, fill, weight, size) =>
    `<text x="${tx}" y="${midY}" font-family="Noto Sans CJK JP, sans-serif" font-size="${size || fs}" font-weight="${weight || 700}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central">${esc(txt)}</text>`;

  const hx = x0 + padX;
  parts.push(T(hx, "start", homeTeam, "#ffffff", 700));
  if (showSets) {
    const htw = estWidth(homeTeam, fs);
    parts.push(T(hx + htw + gapSets, "start", homeSets, "#facc15", 700, fs * 0.8));
  }
  const scoreCx = x0 + wHome + wScore / 2;
  parts.push(T(scoreCx, "middle", scoreText, "#ffffff", 800));
  const awaySegX = x0 + wHome + wScore;
  let ax = awaySegX + padX;
  if (showSets) {
    parts.push(T(ax, "start", awaySets, "#facc15", 700, fs * 0.8));
    ax += estWidth("0", fs) + gapSets;
  }
  parts.push(T(ax, "start", awayTeam, "#ffffff", 700));
  if (period) {
    const pcx = x0 + wHome + wScore + wAway + wPeriod / 2;
    parts.push(T(pcx, "middle", period, "#e5e7eb", 600, fs * 0.95));
  }
  if (extra) {
    const ecx = x0 + wHome + wScore + wAway + wPeriod + wExtra / 2;
    parts.push(T(ecx, "middle", extra, "#fde68a", 700, fs * 0.9));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

module.exports = { buildScoreboardSvg };

if (require.main === module) {
  const fs = require("node:fs");
  const svg = buildScoreboardSvg({
    homeTeam: "ホーム",
    awayTeam: "アウェイ",
    homeScore: 2,
    awayScore: 0,
    homeSets: 1,
    awaySets: 0,
    period: "1セット",
  });
  fs.writeFileSync(process.argv[2] || "/tmp/sb-sample.svg", svg);
  console.log("wrote", process.argv[2] || "/tmp/sb-sample.svg");
}
