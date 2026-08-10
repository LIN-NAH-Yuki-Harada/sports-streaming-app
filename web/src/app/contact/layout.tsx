import type { Metadata } from "next";

// contact/page.tsx は "use client" のため metadata を export できない。
// メタデータ専用の layout をかぶせてタイトル・説明を与える。
export const metadata: Metadata = {
  title: "お問い合わせ",
  description:
    "LIVE SPOtCH のお問い合わせフォーム。配信のトラブル、プラン・お支払い、アカウントに関するご相談を承ります。",
  alternates: { canonical: "/contact" },
  robots: { index: true, follow: true },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
