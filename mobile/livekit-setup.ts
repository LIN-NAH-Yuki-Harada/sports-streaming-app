// LiveKit のグローバル(WebRTC: RTCPeerConnection 等)を登録する。
// 必ず LiveKit / WebRTC を使う他コードより「前」に1回だけ実行する必要があるため、
// 専用モジュールにして index.ts の最初の import で副作用として走らせる
// （ESモジュールの import は宣言順に評価されるため、App より前に確実に実行される）。
// 呼び忘れると起動時に ReferenceError: 'document'/'Event' 等で接続に失敗する（issue #386 対策）。
import { registerGlobals } from "@livekit/react-native";

registerGlobals();
