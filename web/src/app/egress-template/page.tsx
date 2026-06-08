"use client";

/**
 * LiveKit Egress 用カスタムテンプレート（発熱対策 Phase 1-D）。
 *
 * 目的: 焼き込みOFF（生配信）の配信でも、YouTube 用にはスコアを映像に焼き込みたい。
 * その合成を **配信スマホではなく LiveKit Cloud の Chrome（Egress）側でやる**ため、
 * このページを RoomComposite Egress の customBaseUrl テンプレートとして読み込ませる。
 *
 * 構成:
 *   - 背景: LiveKit ルームの配信者カメラ映像（フルスクリーン <video>）＋ 音声（<audio>）
 *   - 前面: スコアボード（Supabase Realtime で更新・drawScoreboard で焼き込み版と同じ絵）
 *   → Egress がこのページ（映像＋音声＋スコア）を録画/RTMP push するので、スマホ無負荷で
 *     スコア入り映像が YouTube に出る。
 *
 * 起動の流れ（Egress 実行時）:
 *   LiveKit が customBaseUrl?broadcastId=...&url=<ws>&token=<recorder token>&layout=... を開く。
 *   EgressHelper から url/token を取り、recorder として room に connect → トラック subscribe →
 *   描画準備ができたら EgressHelper.startRecording()。配信者退室で自動終了。
 *
 * 単体テスト（url/token が無いとき）: room には繋がず、スコアボードのみ黒背景に描画する
 * （Realtime 反映の確認用）。/egress-template?broadcastId=<id> をブラウザで開けば見える。
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Google Translate のバーが Egress の Chrome に出て映像に写り込むのを防ぐ。
  // <meta name="google" content="notranslate"> + translate=no で翻訳プロンプトを抑止。
  useEffect(() => {
    document.documentElement.setAttribute("translate", "no");
    const meta = document.createElement("meta");
    meta.name = "google";
    meta.content = "notranslate";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
      document.documentElement.removeAttribute("translate");
    };
  }, []);

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

  // LiveKit ルーム接続（Egress 実行時のみ。url/token は EgressHelper が query から取る）。
  useEffect(() => {
    let url = "";
    let token = "";
    try {
      url = EgressHelper.getLiveKitURL();
      token = EgressHelper.getAccessToken();
    } catch {
      // 単体テスト（egress 外）では url/token が無い → room 接続はスキップしてスコアのみ描画。
      return;
    }
    if (!url || !token) return;

    const room = new Room({ adaptiveStream: false, dynacast: false });

    const attach = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
      } else if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
      }
    };

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
        attach(track);
      },
    );

    (async () => {
      try {
        await room.connect(url, token);
        EgressHelper.setRoom(room);
        // 既に publish 済みのトラックも attach（接続前に来ていた分）。
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track) attach(pub.track);
          });
        });
        // 描画パイプライン（canvas/video）が整ったら録画開始を通知。
        EgressHelper.startRecording();
      } catch (e) {
        console.error("[egress-template] room 接続失敗:", e);
      }
    })();

    return () => {
      room.disconnect();
    };
  }, []);

  // 描画ループ: スコア変更 or 経過時間（毎秒）で drawScoreboard を再描画。
  // 背景は透明にしてカメラ映像（<video>）が透ける。
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
      {/* 配信者カメラ映像（Egress 実行時に LiveKit から attach される） */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          backgroundColor: "#000",
        }}
      />
      {/* 配信者音声（Egress がページ音声を録る。muted にしない） */}
      <audio ref={audioRef} autoPlay />
      {/* スコアボード（前面・背景透明） */}
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
