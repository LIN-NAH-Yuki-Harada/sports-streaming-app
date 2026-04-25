export type ScoreboardState = {
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  home_sets: number;
  away_sets: number;
  period: string;
  tournament: string | null;
  sport: string;
  pointLabel: string | null;
};

const FONT_STACK =
  '-apple-system, "SF Pro Display", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';

const COLORS = {
  bgDark: "rgba(0, 0, 0, 0.82)",
  bgHighlight: "rgba(255, 255, 255, 0.12)",
  bgPeriod: "rgba(0, 0, 0, 0.6)",
  red: "#e63946",
  yellow: "#facc15",
  white: "#ffffff",
  grayText: "#d4d4d4",
  pointLabel: "#fef08a",
};

export function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  state: ScoreboardState,
  targetW: number,
  targetH: number,
): void {
  ctx.save();
  ctx.textBaseline = "middle";

  const scale = Math.max(targetH / 1080, 0.5);
  const margin = Math.round(24 * scale);
  const h = Math.round(46 * scale);
  const pad = Math.round(12 * scale);
  const gap = Math.round(6 * scale);
  const radius = Math.round(4 * scale);

  const fontTeam = `bold ${Math.round(22 * scale)}px ${FONT_STACK}`;
  const fontScore = `900 ${Math.round(32 * scale)}px ${FONT_STACK}`;
  const fontSet = `bold ${Math.round(14 * scale)}px ${FONT_STACK}`;
  const fontPeriod = `500 ${Math.round(18 * scale)}px ${FONT_STACK}`;
  const fontPill = `500 ${Math.round(18 * scale)}px ${FONT_STACK}`;
  const fontPoint = `700 ${Math.round(16 * scale)}px ${FONT_STACK}`;

  const showSets = state.home_sets > 0 || state.away_sets > 0;

  // 幅の事前計測
  ctx.font = fontTeam;
  const homeTeamW = ctx.measureText(state.home_team).width;
  const awayTeamW = ctx.measureText(state.away_team).width;

  ctx.font = fontSet;
  const homeSetText = String(state.home_sets);
  const awaySetText = String(state.away_sets);
  const homeSetW = showSets ? ctx.measureText(homeSetText).width + gap : 0;
  const awaySetW = showSets ? ctx.measureText(awaySetText).width + gap : 0;

  ctx.font = fontScore;
  const scoreText = `${state.home_score} - ${state.away_score}`;
  const scoreW = ctx.measureText(scoreText).width;

  ctx.font = fontPeriod;
  const periodW = ctx.measureText(state.period).width;

  const homeBlockW = Math.round(homeTeamW + homeSetW + pad * 2);
  const scoreBlockW = Math.round(scoreW + pad * 2);
  const awayBlockW = Math.round(awayTeamW + awaySetW + pad * 2);
  const periodBlockW = Math.round(periodW + pad * 2);
  const totalW = homeBlockW + scoreBlockW + awayBlockW + periodBlockW;

  // ===== 左上: スコアボード =====
  const leftX = margin;
  const topY = margin;

  // 下地の角丸矩形（全体のベース）
  drawRoundedRect(ctx, leftX, topY, totalW, h, radius);
  ctx.fillStyle = COLORS.bgDark;
  ctx.fill();

  let cursor = leftX;

  // 1) ホームチーム
  ctx.fillStyle = COLORS.bgHighlight;
  ctx.fillRect(cursor, topY, homeBlockW, h);
  ctx.font = fontTeam;
  ctx.fillStyle = COLORS.white;
  ctx.fillText(state.home_team, cursor + pad, topY + h / 2);
  if (showSets) {
    ctx.font = fontSet;
    ctx.fillStyle = COLORS.yellow;
    ctx.fillText(homeSetText, cursor + pad + homeTeamW + gap, topY + h / 2);
  }
  cursor += homeBlockW;

  // 2) スコア（赤背景）
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(cursor, topY, scoreBlockW, h);
  ctx.font = fontScore;
  ctx.fillStyle = COLORS.white;
  ctx.fillText(scoreText, cursor + pad, topY + h / 2);
  cursor += scoreBlockW;

  // 3) アウェイチーム
  ctx.fillStyle = COLORS.bgHighlight;
  ctx.fillRect(cursor, topY, awayBlockW, h);
  if (showSets) {
    ctx.font = fontSet;
    ctx.fillStyle = COLORS.yellow;
    ctx.fillText(awaySetText, cursor + pad, topY + h / 2);
  }
  ctx.font = fontTeam;
  ctx.fillStyle = COLORS.white;
  ctx.fillText(state.away_team, cursor + pad + awaySetW, topY + h / 2);
  cursor += awayBlockW;

  // 4) 期間（SET等）
  ctx.fillStyle = COLORS.bgPeriod;
  ctx.fillRect(cursor, topY, periodBlockW, h);
  ctx.font = fontPeriod;
  ctx.fillStyle = COLORS.white;
  ctx.fillText(state.period, cursor + pad, topY + h / 2);

  // ポイントラベル（バレー時のみ、スコアボードの下に小さく）
  if (state.pointLabel) {
    ctx.font = fontPoint;
    const labelW = Math.round(ctx.measureText(state.pointLabel).width + pad * 2);
    const labelH = Math.round(28 * scale);
    const labelY = topY + h + Math.round(6 * scale);
    drawRoundedRect(ctx, leftX, labelY, labelW, labelH, radius);
    ctx.fillStyle = "rgba(234, 179, 8, 0.92)";
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(state.pointLabel, leftX + pad, labelY + labelH / 2);
  }

  // ===== 右上: 大会名ピル（映像に焼き込む） =====
  const tournamentLabel = state.tournament || state.sport;
  if (tournamentLabel) {
    ctx.font = fontPill;
    const w = Math.round(ctx.measureText(tournamentLabel).width + pad * 2);
    const rx = targetW - margin - w;
    drawRoundedRect(ctx, rx, topY, w, h, radius);
    ctx.fillStyle = COLORS.bgDark;
    ctx.fill();
    ctx.fillStyle = COLORS.grayText;
    ctx.fillText(tournamentLabel, rx + pad, topY + h / 2);
  }

  ctx.restore();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
