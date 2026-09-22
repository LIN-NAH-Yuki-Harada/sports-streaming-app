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

// テキスト幅の概算。SVG には自動レイアウトが無いので、枠の幅も文字の位置も
// こちらで計算する必要がある。
//
// ★2026-09-23 改訂: 以前は半角を**一律 0.55倍**としていたが、実際の
//   Noto Sans CJK Bold とは乖離が大きく、**見積もりが足りないぶんだけ
//   次に置く要素が左にずれて、チーム名に食い込んでいた**。
//   実例: "TOKYO" を 5×0.55=2.75em と見積もるが実寸は約 3.5em。
//   22px 足りず、セット数が名前に重なった（本番のアーカイブで発生）。
//
//   文字種ごとに係数を分ける。値は Noto Sans CJK Bold の実測に基づく概算で、
//   完全一致は狙わない（呼び出し側で中央寄せするため、多少の誤差は左右に
//   均等に散って目立たない）。
function estWidth(s, fs) {
  let w = 0;
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0);
    // 全角（CJK・全角記号）。半角カナ(U+FF61-FF9F)は除く
    if (c > 0x2e7f && !(c >= 0xff61 && c <= 0xff9f)) {
      w += fs;
    } else if (ch === " ") {
      w += fs * 0.28;
    } else if (c >= 0x30 && c <= 0x39) {
      w += fs * 0.6; // 数字（tabular-nums 相当）
    } else if (c >= 0x41 && c <= 0x5a) {
      w += fs * 0.7; // 英大文字
    } else if (c >= 0x61 && c <= 0x7a) {
      w += fs * 0.56; // 英小文字
    } else if (c >= 0xff61 && c <= 0xff9f) {
      w += fs * 0.5; // 半角カナ
    } else {
      w += fs * 0.35; // 記号・ハイフン等
    }
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
  // セット数とチーム名の間隔。固定値だと縮小時に詰まるのでフォントサイズに比例させる。
  const gapAt = (fs) => Math.max(6, fs * 0.28);
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
  // セット数は fs*0.8 で描くので、幅の予約も同じサイズで見積もる
  // （fs で見積もると枠だけ広くなり、中身が片側に寄って見える原因になる）。
  const setFsRatio = 0.8;
  const widthAt = (fs, padX) => {
    const setWHome = showSets
      ? estWidth(homeSets, fs * setFsRatio) + gapAt(fs)
      : 0;
    const setWAway = showSets
      ? estWidth(awaySets, fs * setFsRatio) + gapAt(fs)
      : 0;
    const wHome = estWidth(homeTeam, fs) + setWHome + padX * 2;
    const wScore = estWidth(scoreText, fs) + padX * 2;
    const wAway = estWidth(awayTeam, fs) + setWAway + padX * 2;
    const wPeriod = period ? estWidth(period, fs) + padX * 2 : 0;
    const wExtra = extra ? estWidth(extra, fs) + padX * 2 : 0;
    return {
      setWHome,
      setWAway,
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
  const {
    setWHome,
    setWAway,
    wHome,
    wScore,
    wAway,
    wPeriod,
    wExtra,
    total: totalW,
  } = widthAt(fs, padX);
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

  // ★チーム名とセット数は「ひとまとまり」として枠の中央に置く（2026-09-23）
  //
  //   以前は枠の左端から padX の位置に左寄せしていた。しかし枠の幅は estWidth
  //   （半角=フォントサイズ×0.55 の概算）で決めているため、**概算と実寸の差が
  //   すべて右側の余白に溜まり**、中身が左に寄って見えていた。
  //   "A" や "B" のような短い名前ほど差が目立つ（実測で右に十数px の空き）。
  //
  //   まとまりごと中央に置けば、誤差は左右に均等に分かれて視覚的に打ち消される。
  //   スコアと period は元から中央寄せなので、これで全枠の基準が揃う。
  const setFs = fs * setFsRatio;

  // ホーム: 「チーム名 → セット数」（セットを中央のスコア側に寄せる既存の並び）
  const homeGroupW = estWidth(homeTeam, fs) + setWHome;
  const homeStart = x0 + (wHome - homeGroupW) / 2;
  parts.push(T(homeStart, "start", homeTeam, "#ffffff", 700));
  if (showSets) {
    parts.push(
      T(
        homeStart + estWidth(homeTeam, fs) + gapAt(fs),
        "start",
        homeSets,
        "#facc15",
        700,
        setFs,
      ),
    );
  }

  const scoreCx = x0 + wHome + wScore / 2;
  parts.push(T(scoreCx, "middle", scoreText, "#ffffff", 800));

  // アウェイ: 「セット数 → チーム名」（ホームと鏡合わせ）
  const awaySegX = x0 + wHome + wScore;
  const awayGroupW = setWAway + estWidth(awayTeam, fs);
  let ax = awaySegX + (wAway - awayGroupW) / 2;
  if (showSets) {
    parts.push(T(ax, "start", awaySets, "#facc15", 700, setFs));
    ax += setWAway;
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
