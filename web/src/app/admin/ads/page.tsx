import { AdsManager } from "./ads-manager";

export const dynamic = "force-dynamic";

export default function AdminAds() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">広告(CM)</h1>
      <p className="text-xs text-gray-500 mb-5 leading-relaxed">
        スポンサーCMの入稿とコンテキスト配信（競技 / 枠）の管理。配信終了画面などの
        ブランクタイムに表示されます。<br />
        ※ 実際に視聴者へ表示されるのは環境変数{" "}
        <code className="text-gray-400">NEXT_PUBLIC_ADS_ENABLED=true</code>{" "}
        のときだけ（既定OFF）。点灯前にプライバシーポリシー / 規約 / 特商法への広告条項追記が必要です。
      </p>
      <AdsManager />
    </div>
  );
}
