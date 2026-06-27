// URL 等のポリフィル（Supabase JS が必要とする）。最初に読み込む。
import "react-native-url-polyfill/auto";
// LiveKit の WebRTC グローバル登録（App より前に実行する。import は宣言順に評価される）。
import "./livekit-setup";

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
