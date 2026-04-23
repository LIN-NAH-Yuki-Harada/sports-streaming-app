"use client";

import { useState } from "react";
import { useToast } from "@/components/toaster";
import { QRCodeModal } from "@/components/qr-code-modal";

type ShareButtonsProps = {
  url: string;
  title: string;
  description?: string;
};

const BTN_BASE =
  "inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold transition";

export function ShareButtons({ url, title, description }: ShareButtonsProps) {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);

  const shareText = description ? `${title}\n${description}` : title;

  const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(
    `${shareText}\n視聴はこちら → ${url}`
  )}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `${shareText}`
  )}&url=${encodeURIComponent(url)}&hashtags=${encodeURIComponent(
    "LIVESPOtCH"
  )}`;
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    url
  )}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました");
    } catch {
      toast.error("コピーに失敗しました（ブラウザ設定をご確認ください）");
    }
  }

  async function tryNativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
          title,
          text: description,
          url,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <a
          href={lineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BTN_BASE} bg-[#06C755] hover:bg-[#05b34c] text-white`}
          aria-label="LINEで共有"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z" />
          </svg>
          LINE
        </a>
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BTN_BASE} bg-black hover:bg-white/90 hover:text-black border border-white/20 text-white`}
          aria-label="Xで共有"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          X
        </a>
        <a
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BTN_BASE} bg-[#1877F2] hover:bg-[#1465cc] text-white`}
          aria-label="Facebookで共有"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.072z" />
          </svg>
          FB
        </a>
        <button
          type="button"
          onClick={async () => {
            const shared = await tryNativeShare();
            if (!shared) copyLink();
          }}
          className={`${BTN_BASE} bg-white/10 hover:bg-white/20 text-white`}
          aria-label="リンクをコピー or 共有"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 14a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 10a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          コピー
        </button>
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className={`${BTN_BASE} bg-white/10 hover:bg-white/20 text-white`}
          aria-label="QRコードを表示"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 18h3v3h-3zM18 14h3v3h-3z" />
          </svg>
          QR
        </button>
      </div>

      <QRCodeModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        url={url}
        title={title}
      />
    </>
  );
}
