import { requireNativeView } from "expo";
import * as React from "react";
import type { ViewProps } from "react-native";

export type RtmpStatus =
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "error"
  | "interrupted"
  | "resumed"
  // 映像が届いていない（音声だけ流れている疑い）。**配信は止まっていない**。
  | "novideo"
  // 映像が戻った（novideo の解除）。
  | "media";

/**
 * 配信前の映像チェックの厳格度。
 * - "off"   … チェックしない（緊急時の全停止スイッチ）
 * - "warn"  … 既定。映像が確認できなくても**必ず配信は開始し**、警告だけ出す
 * - "block" … 映像が確認できなければ RTMP を張らない（既定では使わない）
 */
export type RtmpPreflightMode = "off" | "warn" | "block";

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
  /** 配信前の映像チェックの厳格度。既定 "warn"（＝正常な配信者を絶対に止めない）。 */
  preflightMode?: RtmpPreflightMode;
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
