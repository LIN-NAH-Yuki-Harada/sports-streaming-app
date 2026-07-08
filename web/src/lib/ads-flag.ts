/**
 * 広告(CM)配信の ON/OFF スイッチ。
 * CLAUDE.md「広告はユーザー拡大後に開始」方針に従い、基盤は先行実装しつつ既定 OFF。
 * NEXT_PUBLIC_ プレフィックスでクライアント/サーバー両方から参照可（バンドル時固定・
 * 値変更後は Redeploy 必要）。本番点灯前にプライバシーポリシー/規約/特商法の広告条項追記が必須。
 */
export function isAdsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADS_ENABLED === "true";
}
