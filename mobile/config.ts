// LIVE SPOtCH モバイル 公開設定（Web版で公開済みの値・秘密ではない）。本番バックエンドに接続。
export const SUPABASE_URL = "https://rjvqjeiyqizqqeduzuyi.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_0fMLhjsUed96W16w73pRMA_cZua8xVt";
export const LIVEKIT_URL = "wss://live-spotch-hfkr0i6y.livekit.cloud";
export const SITE_URL = "https://live-spotch.com";

// Google ログイン用 OAuth クライアントID（公開値・秘密ではない）。
// Web クライアントは YouTube 連携で承認済みのものを再利用（idToken の検証に必須）。
export const GOOGLE_WEB_CLIENT_ID =
  "777091676817-uno0qf11hdhfjhfluc7stnlc40h22q56.apps.googleusercontent.com";
// iOS クライアントは Google Cloud で新規作成（bundle id: com.linnah.livespotch）。
// 作成後にこの値と app.json の iosUrlScheme（逆ドメイン形式）を更新すること。
export const GOOGLE_IOS_CLIENT_ID =
  "777091676817-7cp9hqft9hp18fbevhvgag1kln0uk1mo.apps.googleusercontent.com";
