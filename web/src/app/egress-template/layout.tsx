import type { Metadata } from "next";

/**
 * Egress 合成テンプレート専用レイアウト（発熱対策 Phase 1-D）。
 *
 * 目的: LiveKit Cloud の Chrome（Egress）がこのページを開いたときに出る
 * Google 翻訳バーが録画映像に写り込むのを防ぐ。
 *
 * `<meta name="google" content="notranslate">` を **サーバーレンダリングの初期 HTML**
 * に入れることで、Chrome がページ読み込み時点（クライアント JS 実行前）に翻訳プロンプトを
 * 出さないようにする。client コンポーネントの useEffect で後から meta を足す方式では、
 * 翻訳判定がそれより先に走ってバーが出てしまうため、ここ（layout の metadata）で行う。
 */
export const metadata: Metadata = {
  other: {
    google: "notranslate",
  },
};

export default function EgressTemplateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
