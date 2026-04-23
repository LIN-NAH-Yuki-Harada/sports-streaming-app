"use client";

import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

type QRCodeModalProps = {
  open: boolean;
  onClose: () => void;
  url: string;
  title?: string;
};

export function QRCodeModal({ open, onClose, url, title }: QRCodeModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-xl bg-[#0f0f0f] border border-white/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 rounded-full p-1 text-gray-400 hover:text-white hover:bg-white/10 transition"
          aria-label="閉じる"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center">
          <p className="text-sm font-semibold text-gray-200 mb-1">QR コードで共有</p>
          {title && <p className="text-xs text-gray-500 mb-4 truncate">{title}</p>}

          <div className="mx-auto w-fit rounded-lg bg-white p-4 shadow-inner">
            <QRCodeSVG
              value={url}
              size={220}
              level="M"
              marginSize={0}
              bgColor="#ffffff"
              fgColor="#0a0a0a"
            />
          </div>

          <p className="mt-4 text-[11px] text-gray-500 leading-relaxed break-all">
            {url}
          </p>

          <p className="mt-3 text-[10px] text-gray-600">
            スマホのカメラでスキャンすると視聴ページが開きます
          </p>
        </div>
      </div>
    </div>
  );
}
