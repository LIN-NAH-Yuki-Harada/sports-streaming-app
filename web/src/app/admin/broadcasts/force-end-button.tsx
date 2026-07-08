"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

// LIVE配信の強制終了（ゴースト掃除）。管理者セッションで /api/admin/broadcasts/[id] を叩く。
export function ForceEndButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!confirm(`「${label}」のLIVE配信を強制終了しますか？（ゴースト掃除）`)) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/broadcasts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ action: "end" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={end}
      disabled={busy}
      className="px-2.5 py-1 rounded text-[11px] font-medium bg-[#e63946]/20 hover:bg-[#e63946]/40 text-[#ffb3bb] disabled:opacity-40 transition"
    >
      {busy ? "終了中…" : "強制終了（ゴースト掃除）"}
    </button>
  );
}
