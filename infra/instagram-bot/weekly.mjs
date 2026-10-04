// 週間実績カード: 先週（月〜日・JST）に LIVE SPOtCH で配信された試合の数字を、顔もチーム名も出さずに1枚にする。
import { h, renderPng, fmtMd, JST_OFFSET_MS } from "./lib.mjs";

// 対外的な数字の決まり（9/27〜）: 1分未満のテストと6時間超の切り忘れは数えない
const MIN_MS = 60 * 1000;
const MAX_MS = 6 * 60 * 60 * 1000;

// 直近の「終わった週」（月曜0時〜翌月曜0時・JST）。now が月曜なら前の週。
export function lastCompletedWeek(now = new Date()) {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  const dow = (j.getUTCDay() + 6) % 7; // 月=0 … 日=6
  const thisMonday = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() - dow) - JST_OFFSET_MS;
  return { from: new Date(thisMonday - 7 * 86400000), to: new Date(thisMonday) };
}

export async function fetchWeeklyStats(sb, { from, to }) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    // PostgREST は1回1000行まで（PR #327 の教訓）。全ページ取る
    const { data, error } = await sb
      .from("broadcasts")
      .select("sport, tournament, started_at, ended_at")
      .eq("status", "ended")
      .gte("started_at", from.toISOString())
      .lt("started_at", to.toISOString())
      .range(off, off + 999);
    if (error) throw new Error(`broadcasts の取得に失敗: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const games = rows.filter((r) => {
    const ms = new Date(r.ended_at) - new Date(r.started_at);
    return r.ended_at && ms >= MIN_MS && ms <= MAX_MS;
  });
  const totalMin = Math.round(
    games.reduce((a, r) => a + (new Date(r.ended_at) - new Date(r.started_at)), 0) / 60000
  );
  const bySport = {};
  for (const r of games) bySport[r.sport || "その他"] = (bySport[r.sport || "その他"] || 0) + 1;
  const tournaments = new Set(games.map((r) => (r.tournament || "").trim()).filter(Boolean)).size;
  return {
    from,
    to,
    games: games.length,
    hours: Math.round((totalMin / 60) * 10) / 10,
    tournaments,
    sports: Object.entries(bySport).sort((a, b) => b[1] - a[1]),
  };
}

// ── デザイン: 紺の TV 中継テロップ × 赤は LIVE と行動の呼びかけだけ（LP 方針と統一）
const NAVY = "#0b1f3a";
const NAVY2 = "#132c52";
const RED = "#e60012";
const WHITE = "#ffffff";
const MUTED = "#9fb3d1";

function stat(label, value, unit) {
  return h(
    "div",
    { flexDirection: "column", alignItems: "center", width: 300 },
    h("div", { fontSize: 34, color: MUTED, fontWeight: 500 }, label),
    h(
      "div",
      { alignItems: "baseline", marginTop: 8 },
      h("div", { fontSize: 96, fontWeight: 900, color: WHITE, lineHeight: 1 }, String(value)),
      h("div", { fontSize: 32, fontWeight: 900, color: WHITE, marginLeft: 6 }, unit)
    )
  );
}

export function weeklyCard(s) {
  const lastDay = new Date(s.to.getTime() - 1);
  const top = s.sports.slice(0, 5);
  const max = Math.max(1, ...top.map(([, n]) => n));
  return h(
    "div",
    {
      width: 1080,
      height: 1350,
      flexDirection: "column",
      background: NAVY,
      fontFamily: "Noto Sans JP",
      color: WHITE,
      padding: "72px 72px 0",
    },
    // ヘッダー: LIVE バッジ + サービス名
    h(
      "div",
      { alignItems: "center" },
      h(
        "div",
        { background: RED, color: WHITE, fontSize: 30, fontWeight: 900, padding: "6px 18px", borderRadius: 6 },
        "LIVE"
      ),
      h("div", { fontSize: 34, fontWeight: 900, marginLeft: 20, letterSpacing: 2 }, "LIVE SPOtCH")
    ),
    h("div", { fontSize: 64, fontWeight: 900, marginTop: 56, lineHeight: 1.25 }, "先週のローカルスポーツ"),
    h("div", { fontSize: 36, color: MUTED, marginTop: 12 }, `${fmtMd(s.from)} 〜 ${fmtMd(lastDay)} の配信実績`),
    // 数字3つ
    h(
      "div",
      { marginTop: 64, background: NAVY2, borderRadius: 24, padding: "48px 18px", justifyContent: "space-between" },
      stat("配信された試合", s.games, "試合"),
      stat("合計", s.hours, "時間"),
      stat("大会・試合名", s.tournaments, "件")
    ),
    // 競技別（上位5）
    h(
      "div",
      { flexDirection: "column", marginTop: 56 },
      h("div", { fontSize: 32, color: MUTED, marginBottom: 20 }, "競技別"),
      ...top.map(([sport, n]) =>
        h(
          "div",
          { alignItems: "center", marginBottom: 18 },
          h("div", { width: 220, fontSize: 34, fontWeight: 900 }, sport),
          h("div", {
            height: 30,
            width: Math.round((n / max) * 560),
            background: WHITE,
            borderRadius: 15,
          }),
          h("div", { fontSize: 32, marginLeft: 20, color: MUTED }, `${n}`)
        )
      )
    ),
    h("div", { flex: 1 }),
    // TV テロップ風の帯（呼びかけ）
    h(
      "div",
      { margin: "0 -72px", height: 150, alignItems: "stretch" },
      h(
        "div",
        { background: RED, width: 24 }
      ),
      h(
        "div",
        { flex: 1, background: WHITE, color: NAVY, alignItems: "center", justifyContent: "space-between", padding: "0 48px" },
        h("div", { fontSize: 36, fontWeight: 900 }, "あなたのチームの試合も、スマホ1台で。"),
        h("div", { fontSize: 28, fontWeight: 900, color: RED, flexShrink: 0, marginLeft: 24 }, "live-spotch.com")
      )
    )
  );
}

export function weeklyCaption(s) {
  const lastDay = new Date(s.to.getTime() - 1);
  const sports = s.sports
    .slice(0, 3)
    .map(([sp]) => sp)
    .join("・");
  return [
    `📊 先週のローカルスポーツ（${fmtMd(s.from)}〜${fmtMd(lastDay)}）`,
    "",
    `LIVE SPOtCH で配信された試合は ${s.games} 試合・合計 ${s.hours} 時間。`,
    sports ? `${sports} など、全国の部活・スポ少・地域大会が届けられました。` : "",
    "",
    "会場に行けない家族にも、TV中継のようなスコア付きで。",
    "あなたのチームの試合も、スマホ1台で配信できます。",
    "▶ プロフィールのリンクから無料で試せます",
    "",
    "#部活 #スポ少 #少年野球 #少年サッカー #中学バレー #高校バスケ #ライブ配信 #試合配信 #LIVESPOtCH",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

export async function renderWeekly(s) {
  return renderPng(weeklyCard(s), { width: 1080, height: 1350 });
}
