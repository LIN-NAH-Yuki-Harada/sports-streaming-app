/**
 * iOS だけにローカライズ（ja.lproj）を生成する config plugin。
 *
 * ■ なぜ専用プラグインが要るのか
 * app.json の `expo.locales` を使うと、Expo は **iOS と Android の両方**に
 * ローカライズを生成する。ところが Android 側の実装
 * (@expo/config-plugins/build/android/Locales.js) は、渡した JSON のキーを
 * そのまま Android のリソース名として書き出す:
 *
 *   android/app/src/main/res/values-b+ja/strings.xml
 *     <string name="CFBundleDisplayName">"LIVE SPOtCH 配信"</string>
 *
 * `CFBundleDisplayName` は **iOS 専用のキー名**で、Android が参照するのは
 * `@string/app_name`（AndroidManifest の android:label）。つまり Android には
 * **一切読まれない無意味なリソースが増えるだけ**で、得るものが何も無い。
 * 2026-08-05 に `expo.locales` を入れた直後の Android ビルドが Gradle で失敗した
 * （iOS は同一コミットで成功）ため、Android 側の生成を止める。
 *
 * ■ 実装の要点
 * `setLocalesAsync` に渡す config にだけ locales を差し込み、**返り値には残さない**。
 * app.json から `expo.locales` を消してあるので、Expo の Android 側 Locales プラグインは
 * 発火しない（config.locales が undefined のまま）。
 *
 * ■ 何のために ja.lproj が要るのか
 * App Store で対応言語が「EN 英語」と表示される問題の対策。Apple はバンドル内の
 * `.lproj` フォルダから対応言語を判定するため、`ios.infoPlist` の
 * CFBundleDevelopmentRegion / CFBundleLocalizations だけでは不足する
 * （prebuild して `.lproj` が0件であることを実際に確認済み）。
 */
const { withXcodeProject, IOSConfig } = require("@expo/config-plugins");

// app.json の `expo.locales` と同じ形式。ここが唯一の定義場所。
const LOCALES = { ja: "./locales/ja.json" };

module.exports = function withIosOnlyLocales(config) {
  return withXcodeProject(config, async (cfg) => {
    cfg.modResults = await IOSConfig.Locales.setLocalesAsync(
      // ★ locales はこの呼び出しにだけ渡す。cfg 自体には生やさない
      //   （生やすと Android 側の core plugin が拾ってしまう）。
      { ...cfg, locales: LOCALES },
      { projectRoot: cfg.modRequest.projectRoot, project: cfg.modResults },
    );
    return cfg;
  });
};
