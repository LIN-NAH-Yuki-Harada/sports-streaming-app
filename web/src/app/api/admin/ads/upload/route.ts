import { requireAdmin } from "@/lib/admin-auth";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB（短尺CM想定）
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
]);

// CM素材アップロード（管理者のみ）。service_role で ad-creatives バケットに入稿し公開URLを返す。
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file がありません" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: `非対応の形式です: ${file.type}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "50MB以下にしてください" }, { status: 400 });
  }

  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase().slice(0, 8)
    : file.type.startsWith("video/")
      ? "mp4"
      : "jpg";
  // 衝突回避のため時刻 + サイズ + 乱数なしの安定キー（Date/randomは使うが通常のNodeコードなのでOK）
  const key = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;

  const admin = getAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage
    .from("ad-creatives")
    .upload(key, bytes, { contentType: file.type, upsert: false });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const { data } = admin.storage.from("ad-creatives").getPublicUrl(key);
  return Response.json({
    url: data.publicUrl,
    mediaType: file.type.startsWith("video/") ? "video" : "image",
  });
}
