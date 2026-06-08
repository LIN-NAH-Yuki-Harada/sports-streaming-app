"use client";

/**
 * LiveKit Egress 用カスタムテンプレート（発熱対策 Phase 1-D）。
 *
 * 目的: 焼き込みOFF（生配信）の配信でも、YouTube 用にはスコアを映像に焼き込みたい。
 * その合成を **配信スマホではなく LiveKit Cloud の Chrome（Egress）側でやる**ため、
 * このページを RoomComposite Egress の customBaseUrl テンプレートとして読み込ませる。
 *
 * 構成（最終形）:
 *   - 背景: LiveKit ルームの配信者カメラ映像（フルスクリーン）
 *   - 前面: スコアボード（Supabase Realtime で更新・drawScoreboard で焼き込み版と同じ絵）
 *   → Egress がこのページを録画/RTMP push するので、スマホ無負荷でスコア入り映像になる。
 *
 * 本コミット（PoC 第1段）: まず「Egress Chrome が Supabase Realtime からスコアを受け取り
 * drawScoreboard で描けるか」を単体検証できる形にする。カメラ映像レイヤーと Egress 起動
 * シグナリング（EgressHelper）は次段で追加する。
 * 単体テスト: ブラウザで /egress-template?broadcastId=<id> を開き、配信のスコアを変更すると
 * リアルタイムで反映されることを確認する（背景は黒・カメラ無し）。
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { BROADCAST_PUBLIC_COLUMNS, type Broadcast } from "@/lib/database";
import { drawScoreboard, type ScoreboardState } from "@/lib/scoreboard-canvas";

const EGRESS_W = 1280;
const EGRESS_H = 720;

export default function EgressTemplatePage() {
  return (
    <Suspense fallback={<div style={{ width: "100vw", height: "100vh", background: "#000" }} />}>
      <EgressTemplateInner />
    </Suspense>
  );
}

function EgressTemplateInner() {
  const searchParams = useSearchParams();
  const broadcastId = searchParams.get("broadcastId");

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 配信情報の初回取得
  useEffect(() => {
    if (!broadcastId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("broadcasts")
        .select(BROADCAST_PUBLIC_COLUMNS)
        .eq("id", broadcastId)
        .single();
      if (!cancelled && data) setBroadcast(data as unknown as Broadcast);
    })();
    return () => {
      cancelled = true;
    };
  }, [broadcastId]);

  // Realtime 購読（スコア・期間などの更新を反映）。視聴ページと同じ仕組み。
  useEffect(() => {
    if (!broadcastId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`egress-${broadcastId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "broadcasts",
          filter: `id=eq.${broadcastId}`,
        },
        (payload) => {
          setBroadcast((prev) => (prev ? { ...prev, ...payload.new } : prev));
        },
      )
      .subscribe();
    return () => {
      channel.unsubscribe().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, [broadcastId]);

  // 描画ループ: スコア変更 or 経過時間（毎秒）で drawScoreboard を再描画。
  // 背景は透明にしてカメラ映像（将来レイヤー）が透ける状態にする。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function paint() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, EGRESS_W, EGRESS_H);
      if (!broadcast) return;
      const startMs = broadcast.started_at
        ? new Date(broadcast.started_at).getTime()
        : NaN;
      const elapsedSeconds = Number.isNaN(startMs)
        ? null
        : Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const state: ScoreboardState = {
        home_team: broadcast.home_team,
        away_team: broadcast.away_team,
        home_score: broadcast.home_score,
        away_score: broadcast.away_score,
        home_sets: broadcast.home_sets,
        away_sets: broadcast.away_sets,
        period: broadcast.period,
        tournament: broadcast.tournament,
        sport: broadcast.sport,
        // バレーのセット/マッチポイントは配信者のルール設定が broadcast 行に
        // 未保存のため省略（視聴側オーバーレイと同じ既知の差分）。
        pointLabel: null,
        elapsedSeconds,
      };
      drawScoreboard(ctx, state, EGRESS_W, EGRESS_H);
    }

    paint();
    const interval = setInterval(paint, 1000);
    return () => clearInterval(interval);
  }, [broadcast]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#000",
        overflow: "hidden",
      }}
    >
      {/* TODO(1-D 次段): ここに LiveKit ルームの配信者カメラ映像を全面表示する。 */}
      <canvas
        ref={canvasRef}
        width={EGRESS_W}
        height={EGRESS_H}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
