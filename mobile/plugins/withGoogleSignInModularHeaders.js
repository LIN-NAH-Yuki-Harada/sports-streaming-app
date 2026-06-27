// GoogleSignin v16 は内部で AppCheckCore → GoogleUtilities / RecaptchaInterop を引き込む。
// これらは「静的ライブラリ統合に未対応（モジュール未定義）」のため、Expo 既定の static linking では
// pod install が失敗する（"cannot be integrated as static libraries ... use_modular_headers!"）。
// 対策: 該当 pod にだけ :modular_headers => true を付与してモジュールマップを生成させる。
// リンク方式（use_frameworks）は変えない＝既存の LiveKit / react-native-webrtc 構成に影響しない。
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const POD_LINES = [
  "  pod 'GoogleUtilities', :modular_headers => true",
  "  pod 'RecaptchaInterop', :modular_headers => true",
  "  pod 'AppCheckCore', :modular_headers => true",
];

const MARKER = "GoogleUtilities', :modular_headers";

module.exports = function withGoogleSignInModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        "Podfile",
      );
      let contents = fs.readFileSync(podfilePath, "utf8");
      if (!contents.includes(MARKER)) {
        // target ブロック先頭の use_expo_modules! 直後に pod 宣言を差し込む。
        contents = contents.replace(
          "use_expo_modules!",
          "use_expo_modules!\n" + POD_LINES.join("\n"),
        );
        fs.writeFileSync(podfilePath, contents);
      }
      return cfg;
    },
  ]);
};
