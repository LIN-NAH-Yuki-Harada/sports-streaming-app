"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const SPORTS = ["サッカー", "野球", "バスケ", "バレー", "陸上", "その他"];
const PLACEMENTS: { key: string; label: string }[] = [
  { key: "postroll", label: "配信終了画面" },
  { key: "archive_pre", label: "アーカイブ導線" },
  { key: "preroll", label: "視聴前" },
  { key: "waiting", label: "待機中" },
];

type Creative = {
  id: string;
  media_type: string;
  media_url: string;
  duration_seconds: number | null;
};
type Campaign = {
  id: string;
  sponsor_name: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  target_sports: string[] | null;
  placements: string[] | null;
  weight: number;
  label: string;
  ad_creatives: Creative[] | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export function AdsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // フォーム state
  const [sponsorName, setSponsorName] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [weight, setWeight] = useState(1);
  const [label, setLabel] = useState("PR");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ads/campaigns", {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const j = await res.json();
        setCampaigns(j.campaigns ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  function toggleIn(arr: string[], v: string, set: (a: string[]) => void) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  async function handleUpload(file: File) {
    setErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/ads/upload", {
        method: "POST",
        headers: await authHeaders(),
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "アップロードに失敗しました");
        return;
      }
      setMediaUrl(j.url);
      setMediaType(j.mediaType === "video" ? "video" : "image");
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate() {
    setErr(null);
    if (!sponsorName.trim()) {
      setErr("スポンサー名を入力してください");
      return;
    }
    if (!mediaUrl) {
      setErr("CM素材をアップロードしてください");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          sponsorName,
          targetSports: sports,
          placements: places,
          weight,
          label,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          creative: { mediaType, mediaUrl },
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "作成に失敗しました");
        return;
      }
      // リセット
      setSponsorName("");
      setSports([]);
      setPlaces([]);
      setWeight(1);
      setLabel("PR");
      setStartsAt("");
      setEndsAt("");
      setMediaUrl("");
      setMediaType("image");
      await refetch();
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(c: Campaign) {
    await fetch(`/api/admin/ads/campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ active: !c.active }),
    });
    await refetch();
  }

  async function remove(c: Campaign) {
    if (!confirm(`「${c.sponsor_name}」を削除しますか？`)) return;
    await fetch(`/api/admin/ads/campaigns/${c.id}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    await refetch();
  }

  const input =
    "w-full bg-[#111] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e63946]/60";

  return (
    <div className="space-y-8">
      {/* 入稿フォーム */}
      <section className="bg-[#0d0d0d] border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-bold mb-4">新しいCMを入稿</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">スポンサー名 *</label>
            <input
              className={input}
              value={sponsorName}
              onChange={(e) => setSponsorName(e.target.value)}
              placeholder="例: ○○スポーツ用品店"
            />
          </div>

          <div>
            <label className="block text-[11px] text-gray-400 mb-1">
              CM素材 *（画像 / 動画・50MBまで）
            </label>
            <input
              type="file"
              accept="image/*,video/mp4,video/webm"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
              className="text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-white/10 file:text-white file:text-xs"
            />
            {uploading && (
              <p className="text-[11px] text-gray-500 mt-1">アップロード中…</p>
            )}
            {mediaUrl && (
              <div className="mt-2 max-w-[200px]">
                {mediaType === "video" ? (
                  <video src={mediaUrl} muted className="w-full rounded-md" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl} alt="preview" className="w-full rounded-md" />
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-gray-400 mb-1">
              対象競技（未選択＝全競技）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SPORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleIn(sports, s, setSports)}
                  className={`px-2.5 py-1 rounded text-[11px] border transition ${
                    sports.includes(s)
                      ? "bg-[#e63946] border-[#e63946] text-white"
                      : "border-white/15 text-gray-400 hover:bg-white/5"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-gray-400 mb-1">
              表示枠（未選択＝全枠）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PLACEMENTS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => toggleIn(places, p.key, setPlaces)}
                  className={`px-2.5 py-1 rounded text-[11px] border transition ${
                    places.includes(p.key)
                      ? "bg-[#e63946] border-[#e63946] text-white"
                      : "border-white/15 text-gray-400 hover:bg-white/5"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">ラベル表示</label>
              <input
                className={input}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="PR"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">
                配信ウェイト（1〜100）
              </label>
              <input
                type="number"
                min={1}
                max={100}
                className={input}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">
                開始日時（任意）
              </label>
              <input
                type="datetime-local"
                className={input}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">
                終了日時（任意）
              </label>
              <input
                type="datetime-local"
                className={input}
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <button
            type="button"
            disabled={creating || uploading}
            onClick={handleCreate}
            className="bg-[#e63946] hover:bg-[#d62836] disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-md transition"
          >
            {creating ? "作成中…" : "CMを登録する"}
          </button>
        </div>
      </section>

      {/* 一覧 */}
      <section>
        <h2 className="text-sm font-bold mb-3">
          入稿済みCM {loading ? "" : `（${campaigns.length}件）`}
        </h2>
        {loading ? (
          <p className="text-xs text-gray-500">読み込み中…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-xs text-gray-500">まだCMはありません。</p>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const cr = c.ad_creatives?.[0];
              return (
                <div
                  key={c.id}
                  className="bg-[#0d0d0d] border border-white/10 rounded-lg p-3 flex gap-3 items-start"
                >
                  <div className="w-24 shrink-0 rounded overflow-hidden bg-black">
                    {cr?.media_type === "video" ? (
                      <video src={cr.media_url} muted className="w-full" />
                    ) : cr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cr.media_url} alt={c.sponsor_name} className="w-full" />
                    ) : (
                      <div className="aspect-video flex items-center justify-center text-[10px] text-gray-600">
                        素材なし
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">
                        {c.sponsor_name}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          c.active
                            ? "bg-green-600/30 text-green-300"
                            : "bg-white/10 text-gray-400"
                        }`}
                      >
                        {c.active ? "配信中" : "停止中"}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      競技:{" "}
                      {c.target_sports && c.target_sports.length > 0
                        ? c.target_sports.join(" / ")
                        : "全競技"}
                      {" ・ "}
                      枠:{" "}
                      {c.placements && c.placements.length > 0
                        ? c.placements.join(" / ")
                        : "全枠"}
                      {" ・ "}ウェイト {c.weight}
                    </p>
                    {(c.starts_at || c.ends_at) && (
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        期間: {c.starts_at?.slice(0, 16).replace("T", " ") ?? "無期限"} 〜{" "}
                        {c.ends_at?.slice(0, 16).replace("T", " ") ?? "無期限"}
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-2">
                      <button
                        onClick={() => toggleActive(c)}
                        className="px-2.5 py-1 rounded text-[11px] bg-white/10 hover:bg-white/20 transition"
                      >
                        {c.active ? "停止する" : "配信する"}
                      </button>
                      <button
                        onClick={() => remove(c)}
                        className="px-2.5 py-1 rounded text-[11px] bg-white/5 hover:bg-red-600/40 text-gray-400 hover:text-white transition"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
