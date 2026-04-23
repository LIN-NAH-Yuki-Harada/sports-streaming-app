import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "料金プラン",
  description:
    "LIVE SPOtCH の料金プラン。視聴は完全無料。配信者プラン¥300/月、チームプラン¥500/月。初回10分間は無料でお試し可能。先着20チームはプロモコード『SPOT』で初月完全無料。",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "料金プラン | LIVE SPOtCH",
    description:
      "視聴は完全無料。配信者プラン¥300/月・チームプラン¥500/月。先着20チーム初月無料コード『SPOT』。",
    url: "/pricing",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "料金プラン | LIVE SPOtCH",
    description:
      "視聴は完全無料。配信者プラン¥300/月・チームプラン¥500/月。先着20チーム初月無料コード『SPOT』。",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
