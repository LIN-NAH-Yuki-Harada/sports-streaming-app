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
  /** 既定 1280。 */
  videoWidth?: number;
  /** 既定 720。 */
  videoHeight?: number;
  /** bps。既定 4,000,000（4Mbps）。RTMP はバッファ型なので 4G でも安定して通る。 */
  videoBitrate?: number;
  /** 既定 30。 */
  fps?: number;
  /** 既定 "back"。 */
  cameraPosition?: "back" | "front";
  /** 配信状態の通知。 */
  onStatus?: (event: RtmpStatusEvent) => void;
};

const NativeView = requireNativeView<RtmpPublisherViewProps>("RtmpPublisher");

export default function RtmpPublisherView(props: RtmpPublisherViewProps) {
  return <NativeView {...props} />;
}
