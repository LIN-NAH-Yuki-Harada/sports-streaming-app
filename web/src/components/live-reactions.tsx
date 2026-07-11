"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";

// ライブ応援スタンプ（❤️ / 👍）
// ------------------------------------------------------------------
// 仕様（2026-06-11 確定）: 視聴ページに❤️/👍ボタン → 押すと画面にハートが
// ふわっと浮かぶ。配信者＆全視聴者にリアルタイムで伝わる。
// 実装: Supabase Realtime の "broadcast" イベント（DB不要・ephemeral）。
// チャンネル名 = reactions-${shareCode}（Web視聴者・配信者アプリで共通）。
// 子ども安全: ハート/拍手のみ＝テキスト無し＝誹謗中傷の余地ゼロ。
// ------------------------------------------------------------------

type ReactionKind = "heart" | "clap";

const EMOJI: Record<ReactionKind, string> = {
  heart: "❤️",
  clap: "👍",
};

// 画面に浮かぶ1個分のスタンプ
type FloatingItem = {
  id: number;
  kind: ReactionKind;
  left: number; // 出現位置（左からの%・ボタン付近にばらける）
  drift: number; // 上昇しながらの横ドリフト(px)
  size: number; // フォントサイズ(px)
  duration: number; // アニメーション時間(ms)
};

// 連打対策: 送信は最短 120ms 間隔。画面上の同時表示は最大 40 個でキャップ。
const SEND_THROTTLE_MS = 120;
const MAX_ON_SCREEN = 40;

export function LiveReactions({ shareCode }: { shareCode: string }) {
  const [items, setItems] = useState<FloatingItem[]>([]);
  const idRef = useRef(0);
  const lastSentRef = useRef(0);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  // 1個分のスタンプを画面に追加し、duration 後に自動で消す
  const spawn = useCallback((kind: ReactionKind) => {
    const id = idRef.current++;
    const item: FloatingItem = {
      id,
      kind,
      // 右端ボタン付近（78〜90%）にばらつかせる。中央のプレー映像に
      // かからないよう、スタンプは右端に沿って上昇させる（2026-07-11 実戦FB）。
      left: 78 + Math.random() * 12,
      drift: Math.random() * 32 - 16, // -16〜16px（右端から大きく離れない）
      size: 18 + Math.random() * 10, // 18〜28px（プレーを隠さない控えめサイズ）
      duration: 2200 + Math.random() * 700, // 2.2〜2.9s
    };
    setItems((prev) => {
      const next = prev.length >= MAX_ON_SCREEN ? prev.slice(1) : prev;
      return [...next, item];
    });
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, item.duration);
  }, []);

  // Realtime チャンネル購読（受信したら spawn）
  useEffect(() => {
    if (!shareCode) return;
    const supabase = createClient();
    const channel = supabase.channel(`reactions-${shareCode}`, {
      // self:false → 自分の送信は受信しない（送信側はローカルで即時 spawn 済み）
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "react" }, ({ payload }) => {
        const kind = (payload as { kind?: ReactionKind })?.kind;
        if (kind === "heart" || kind === "clap") spawn(kind);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channel.unsubscribe().catch(() => {});
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [shareCode, spawn]);

  // ボタン押下: ローカル即時表示 + 全視聴者/配信者へ送信（throttle）
  const send = useCallback(
    (kind: ReactionKind) => {
      spawn(kind); // 自分の画面はすぐ反応（送信往復を待たない）
      const now = Date.now();
      if (now - lastSentRef.current < SEND_THROTTLE_MS) return;
      lastSentRef.current = now;
      channelRef.current
        ?.send({ type: "broadcast", event: "react", payload: { kind } })
        .catch(() => {});
    },
    [spawn],
  );

  return (
    <>
      {/* キーフレーム（コンポーネント内に1度だけ描画・他と衝突しない接頭辞付き） */}
      <style>{`
        @keyframes lsReactFloat {
          0%   { transform: translateY(0) translateX(0) scale(0.6); opacity: 0; }
          12%  { opacity: 1; transform: translateY(-12px) scale(1); }
          100% { transform: translateY(-220px) translateX(var(--ls-drift, 0px)) scale(1); opacity: 0; }
        }
      `}</style>

      {/* 浮かぶスタンプ層（タップを透過・映像操作を邪魔しない） */}
      <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
        {items.map((it) => (
          <span
            key={it.id}
            aria-hidden="true"
            className="absolute select-none"
            style={{
              left: `${it.left}%`,
              bottom: "148px",
              fontSize: `${it.size}px`,
              ["--ls-drift" as string]: `${it.drift}px`,
              animation: `lsReactFloat ${it.duration}ms ease-out forwards`,
            }}
          >
            {EMOJI[it.kind]}
          </span>
        ))}
      </div>

      {/* 応援ボタン（右端に縦積み・右下コントロール群の上）。
          下中央だと縦画面でプレー映像に重なるため右端へ（2026-07-11 実戦FB）。 */}
      <div className="absolute bottom-16 right-3 z-[4] flex flex-col items-center gap-2">
        <button
          onClick={() => send("heart")}
          aria-label="ハートで応援"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-base backdrop-blur-sm transition active:scale-90 hover:bg-black/75"
        >
          ❤️
        </button>
        <button
          onClick={() => send("clap")}
          aria-label="いいねで応援"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-base backdrop-blur-sm transition active:scale-90 hover:bg-black/75"
        >
          👍
        </button>
      </div>
    </>
  );
}
