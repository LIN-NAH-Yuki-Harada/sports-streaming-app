"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase";
import { updateProfile } from "@/lib/database";
import { useToast } from "@/components/toaster";

const AVATAR_MAX_SIZE = 256;
const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

type Props = {
  userId: string;
  avatarUrl: string | null;
  fallbackChar: string;
  onUpdated: () => void | Promise<void>;
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASSES = {
  sm: "w-12 h-12",
  md: "w-16 h-16",
  lg: "w-20 h-20",
} as const;

const PIXEL_SIZE = {
  sm: 48,
  md: 64,
  lg: 80,
} as const;

export function AvatarUploader({
  userId,
  avatarUrl,
  fallbackChar,
  onUpdated,
  size = "md",
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを連続選択できるようリセット
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルを選択してください");
      return;
    }
    if (file.size > FILE_SIZE_LIMIT) {
      toast.error("画像サイズは 5MB 以下にしてください");
      return;
    }

    setUploading(true);
    try {
      const blob = await resizeImage(file, AVATAR_MAX_SIZE);
      const supabase = createClient();
      const filePath = `${userId}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      // キャッシュバスター付きで保存（CDN キャッシュ回避）
      const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`;
      const updated = await updateProfile(userId, { avatar_url: cacheBustedUrl });
      if (!updated) throw new Error("プロフィール更新に失敗しました");

      // 旧画像を削除（自分のフォルダ内・現在のものを除外）
      cleanupOldAvatars(userId, filePath).catch(() => {
        // ベストエフォート
      });

      await onUpdated();
      toast.success("アイコンを更新しました");
    } catch (e) {
      console.error("[avatar] アップロードエラー:", e);
      toast.error(
        "アイコンのアップロードに失敗しました。時間をおいて再度お試しください。",
      );
    } finally {
      setUploading(false);
    }
  }

  const sizeClass = SIZE_CLASSES[size];
  const pixelSize = PIXEL_SIZE[size];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={openPicker}
        disabled={uploading}
        aria-label="アイコンを変更"
        className={`${sizeClass} relative rounded-full overflow-hidden flex items-center justify-center bg-[#e63946]/20 text-[#e63946] text-sm md:text-lg font-bold transition hover:opacity-90 disabled:opacity-60`}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt="プロフィールアイコン"
            width={pixelSize}
            height={pixelSize}
            className="w-full h-full object-cover"
            unoptimized
          />
        ) : (
          <span>{fallbackChar}</span>
        )}
        {/* 編集オーバーレイ */}
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition">
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.81-1.21A2 2 0 0110.07 4h3.86a2 2 0 011.66.89l.82 1.2a2 2 0 001.66.91H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </span>
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/60">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </span>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}

// クライアント側で画像を正方形にトリミング+リサイズして JPEG に再エンコード。
async function resizeImage(file: File, maxSize: number): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  // 中央正方形にトリミング
  const side = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - side) / 2);
  const sy = Math.floor((img.height - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = maxSize;
  canvas.height = maxSize;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("canvas context が取得できませんでした");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, maxSize, maxSize);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("画像エンコードに失敗しました")),
      "image/jpeg",
      0.9,
    );
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("読込失敗"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    img.src = src;
  });
}

async function cleanupOldAvatars(userId: string, currentPath: string) {
  const supabase = createClient();
  const { data: list } = await supabase.storage.from("avatars").list(userId);
  if (!list?.length) return;
  const currentFile = currentPath.split("/").pop();
  const stale = list
    .filter((f) => f.name !== currentFile)
    .map((f) => `${userId}/${f.name}`);
  if (stale.length) {
    await supabase.storage.from("avatars").remove(stale);
  }
}
