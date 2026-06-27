// ルートスタックの画面パラメータ型。App.tsx と各画面で共有する。
// （App.tsx に置くと App→画面→App の循環 import になるため独立ファイルにする）
export type RootStackParamList = {
  // 下タブ一式（ホーム/チーム/配信/履歴/マイページ）
  Tabs: undefined;
  // アプリ内ネイティブ視聴画面（全画面・LiveKit 直接視聴）。share_code で対象配信を開く。
  Watch: { shareCode: string };
};
