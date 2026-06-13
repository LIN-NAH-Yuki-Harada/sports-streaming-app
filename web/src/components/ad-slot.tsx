"use client";

import { useEffect, useRef, useState } from "react";
import { isAdsEnabled } from "@/lib/ads-flag";

type Ad = {
  campaignId: string;
  sponsorName: string;
  mediaType: string; // 'image' | 'video'
  mediaUrl: string;
  durationSeconds: number | null;
  label: string;
};

/**
 * ブランクタイムCM枠。配信終了画面・視聴前画面などの「空き時間」に表示する。
 * フラグOFF・在庫なし時は何も描画しない（レイアウトに影響を残さない）。
 * 視聴者の識別子は一切送らない（placement と sport のコンテキストのみ）。
 */
export function AdSlot({
  placement,
  sport,
  className,
}: {
  placement: string;
  sport?: string | null;
  className?: string;
}) {
  const [ad, setAd] = useState<Ad | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!isAdsEnabled()) return;
    let cancelled = false;
    const params = new URLSearchParams({ placement });
    if (sport) params.set("sport", sport);
    fetch(`/api/ads/serve?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.ad) return;
        setAd(data.ad as Ad);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [placement, sport]);

  // インプレッション計測（広告が実際に描画された時に1回だけ）
  useEffect(() => {
    if (!ad || firedRef.current) return;
    firedRef.current = true;
    fetch("/api/ads/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: ad.campaignId, placement }),
    }).catch(() => {});
  }, [ad, placement]);

  if (!ad) return null;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
        boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 2,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "#fff",
          background: "rgba(0,0,0,0.55)",
          padding: "2px 8px",
          borderRadius: 6,
        }}
      >
        {ad.label || "PR"}
      </span>
      {ad.mediaType === "video" ? (
        <video
          src={ad.mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          style={{ width: "100%", display: "block" }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.mediaUrl}
          alt={ad.sponsorName}
          style={{ width: "100%", display: "block" }}
        />
      )}
      <div
        style={{
          fontSize: 11,
          color: "#cbd5e1",
          padding: "6px 10px",
          textAlign: "right",
          background: "#0b0b0b",
        }}
      >
        {ad.sponsorName}
      </div>
    </div>
  );
}
