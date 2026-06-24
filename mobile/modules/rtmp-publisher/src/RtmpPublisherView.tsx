import { requireNativeView } from "expo";
import * as React from "react";
import type { ViewProps } from "react-native";

export type RtmpStatus = "connecting" | "open" | "closing" | "closed" | "error";

export type RtmpStatusEvent = {
  nativeEvent: { state: RtmpStatus; message?: string | null };
};

export type RtmpPublisherViewProps = ViewProps & {
  /** 完全な RTMP URL（LiveKit Ingress の rtmpUrl + "/" + streamKey を結合）。空/未指定の間は配信しない。 */
  streamUrl?: string | null;
  /** true で配信開始 / false で停止。 */
  active?: boolean;
  /** 既定 1280（720p 標準）。 */
  videoWidth?: number;
  /** 既定 720（720p 標準）。 */
  videoHeight?: number;
  /** bps。既定 6,000,000（6Mbps＝720p60 高画質）。弱い上りでは配信中に bitrate/fps を自動降格。 */
  videoBitrate?: number;
  /** 既定 60（スポーツの動きを滑らかに）。 */
  fps?: number;
  /** 既定 "back"。 */
  cameraPosition?: "back" | "front";
  /**
   * 映像に焼き込むスコアボードの1行テキスト（JS側で整形して渡す）。
   * 空文字なら非表示。スパイク検証用（ネイティブGPU合成で発熱しないか確認）。
   */
  scoreboardText?: string | null;
  /** スコアボードの表示/非表示。既定 true。 */
  scoreboardVisible?: boolean;
  /** 配信状態の通知。 */
  onStatus?: (event: RtmpStatusEvent) => void;
};

const NativeView = requireNativeView<RtmpPublisherViewProps>("RtmpPublisher");

export default function RtmpPublisherView(props: RtmpPublisherViewProps) {
  return <NativeView {...props} />;
}
