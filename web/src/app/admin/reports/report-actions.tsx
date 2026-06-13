"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

// 通報のステータス更新ボタン（管理者のセッショントークンで /api/admin/reports/[id] を叩く）。
const ACTIONS: { status: string; label: string; cls: string }[] = [
  { status: "reviewed", label: "確認済み", cls: "bg-white/10 hover:bg-white/20" },
  { status: "actioned", label: "対応した", cls: "bg-green-600/30 hover:bg-green-600/50" },
  { status: "dismissed", label: "却下", cls: "bg-white/5 hover:bg-white/15 text-gray-400" },
];

export function ReportActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(next: string) {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/admin/reports/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-1.5 mt-2">
      {ACTIONS.map((a) => (
        <button
          key={a.status}
          disabled={busy || status === a.status}
          onClick={() => setStatus(a.status)}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition disabled:opacity-40 ${a.cls}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
