import { ImageResponse } from "next/og";
import { getAdminClient } from "@/lib/supabase-admin";
import type { Broadcast } from "@/lib/database";

export const alt = "LIVE SPOtCH の配信";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 現在スコアを常に最新で表示するためキャッシュさせない
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 必要な文字だけを含むサブセット Noto Sans JP を Google Fonts から取得
async function loadFont(text: string, weight: 400 | 700): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(
    text
  )}`;
  const cssRes = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  const css = await cssRes.text();
  const match = css.match(/src:\s*url\((.+?)\)\s*format/);
  if (!match) throw new Error("Failed to parse Google Fonts CSS");
  const fontRes = await fetch(match[1]);
  return await fontRes.arrayBuffer();
}

async function fetchBroadcast(code: string): Promise<Broadcast | null> {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("broadcasts")
      .select("*")
      .eq("share_code", code.toUpperCase())
      .single();
    if (error) return null;
    return data as Broadcast;
  } catch {
    return null;
  }
}

function sportLabel(sport: string): string {
  const map: Record<string, string> = {
    サッカー: "⚽",
    野球: "⚾",
    バスケ: "🏀",
    バレー: "🏐",
    陸上: "🏃",
    テニス: "🎾",
    卓球: "🏓",
    水泳: "🏊",
    ラグビー: "🏉",
    ハンドボール: "🤾",
  };
  return map[sport] ?? "🏆";
}

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const broadcast = await fetchBroadcast(code);

  const isLive = broadcast?.status === "live";
  const home = broadcast?.home_team ?? "Home";
  const away = broadcast?.away_team ?? "Away";
  const homeScore = broadcast?.home_score ?? 0;
  const awayScore = broadcast?.away_score ?? 0;
  const tournament = broadcast?.tournament ?? "";
  const sport = broadcast?.sport ?? "";
  const icon = sportLabel(sport);
  const statusLabel = broadcast
    ? isLive
      ? "LIVE 配信中"
      : "配信終了"
    : "配信を探しています";
  const subLine = [sport, tournament].filter(Boolean).join(" ・ ");

  const textForFont = [
    home,
    away,
    sport,
    tournament,
    "LIVE配信中配信終了配信を探しています",
    "スポーツ中継はLIVE SPOtCH",
    "共有コード",
  ].join("");

  const [fontBold, fontRegular] = await Promise.all([
    loadFont(textForFont, 700).catch(() => null),
    loadFont(textForFont, 400).catch(() => null),
  ]);

  const fonts = [
    fontBold && {
      name: "NotoSansJP",
      data: fontBold,
      style: "normal" as const,
      weight: 700 as const,
    },
    fontRegular && {
      name: "NotoSansJP",
      data: fontRegular,
      style: "normal" as const,
      weight: 400 as const,
    },
  ].filter(Boolean) as {
    name: string;
    data: ArrayBuffer;
    style: "normal";
    weight: 400 | 700;
  }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "radial-gradient(ellipse at top, rgba(230,57,70,0.25), transparent 55%), radial-gradient(ellipse at bottom left, rgba(230,57,70,0.12), transparent 60%)",
          color: "white",
          fontFamily: "NotoSansJP",
          padding: 60,
          position: "relative",
        }}
      >
        {/* 上段: ロゴ / LIVE バッジ */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                backgroundColor: "#e63946",
                color: "white",
                fontWeight: 900,
                fontSize: 22,
                padding: "4px 14px",
                borderRadius: 6,
                letterSpacing: 4,
              }}
            >
              LIVE
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
              LIVE SPOtCH
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 22px",
              borderRadius: 999,
              backgroundColor: isLive ? "#e63946" : "rgba(255,255,255,0.08)",
              border: isLive
                ? "1px solid #e63946"
                : "1px solid rgba(255,255,255,0.15)",
              color: isLive ? "white" : "#9ca3af",
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            {isLive && (
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: "white",
                }}
              />
            )}
            {statusLabel}
          </div>
        </div>

        {/* 中段: チーム vs スコア vs チーム */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            marginTop: 20,
          }}
        >
          {subLine && (
            <div
              style={{
                fontSize: 28,
                color: "#9ca3af",
                marginBottom: 18,
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 36 }}>{icon}</span>
              <span>{subLine}</span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 30,
            }}
          >
            {/* HOME */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  color: "#9ca3af",
                  marginBottom: 10,
                  letterSpacing: 3,
                }}
              >
                HOME
              </div>
              <div
                style={{
                  fontSize: 68,
                  fontWeight: 700,
                  lineHeight: 1.08,
                  display: "-webkit-box",
                  overflow: "hidden",
                  maxWidth: 420,
                }}
              >
                {home}
              </div>
            </div>

            {/* スコア */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 28,
                padding: "18px 34px",
                borderRadius: 20,
                border: "2px solid rgba(230,57,70,0.4)",
                backgroundColor: "rgba(230,57,70,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 120,
                  fontWeight: 700,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 100,
                  textAlign: "center",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                {homeScore}
              </div>
              <div style={{ fontSize: 70, color: "#6b7280", lineHeight: 1 }}>
                -
              </div>
              <div
                style={{
                  fontSize: 120,
                  fontWeight: 700,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 100,
                  textAlign: "center",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                {awayScore}
              </div>
            </div>

            {/* AWAY */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  color: "#9ca3af",
                  marginBottom: 10,
                  letterSpacing: 3,
                }}
              >
                AWAY
              </div>
              <div
                style={{
                  fontSize: 68,
                  fontWeight: 700,
                  lineHeight: 1.08,
                  textAlign: "right",
                  display: "-webkit-box",
                  overflow: "hidden",
                  maxWidth: 420,
                }}
              >
                {away}
              </div>
            </div>
          </div>
        </div>

        {/* 下段: 共有コードと訴求 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: 20,
                color: "#6b7280",
                letterSpacing: 4,
              }}
            >
              共有コード
            </div>
            <div
              style={{
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: 6,
                color: "white",
              }}
            >
              {code.toUpperCase()}
            </div>
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#9ca3af",
            }}
          >
            スポーツ中継は LIVE SPOtCH
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    }
  );
}
