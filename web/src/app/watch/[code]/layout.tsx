import type { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase-admin";
import type { Broadcast } from "@/lib/database";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const broadcast = await fetchBroadcast(code);

  if (!broadcast) {
    return {
      title: "配信を探しています",
      description:
        "LIVE SPOtCH で配信される地域スポーツの試合をリアルタイムで観戦できます。",
    };
  }

  const isLive = broadcast.status === "live";
  const score = `${broadcast.home_score}-${broadcast.away_score}`;
  const matchup = `${broadcast.home_team} vs ${broadcast.away_team}`;
  const statusLabel = isLive ? "LIVE 配信中" : "配信終了";
  const title = `${matchup} | ${score} | ${statusLabel}`;
  const extras = [broadcast.sport, broadcast.tournament ?? ""]
    .filter(Boolean)
    .join(" / ");
  const description = `${statusLabel}｜${matchup}（${score}）${
    extras ? ` ・ ${extras}` : ""
  }。LIVE SPOtCH の共有コード ${code.toUpperCase()} で視聴できます。`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/watch/${code.toUpperCase()}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    // 視聴ページは会員向けなので検索インデックスは引き続き許可しない
    robots: { index: false, follow: false },
  };
}

export default function WatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
