"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type Audience = "broadcasters" | "paying" | "all";

type Meta = {
  counts: Record<Audience, number>;
  labels: Record<Audience, string>;
  from: string | null;
  replyTo: string | null;
  ready: boolean;
};

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token ?? ""}`,
  };
}

/**
 * 一斉送信の画面。
 *
 * ★手順を「テスト送信 → 本送信」に固定している。
 *   テスト送信を済ませないと本送信ボタンが押せない。押し間違いで全員に飛ぶのを防ぐため。
 *   文面を編集し直すとテスト済みの状態は解除され、もう一度テストが必要になる。
 */
export function MailComposer() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [audience, setAudience] = useState<Audience>("broadcasters");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [testedTo, setTestedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "send">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/email", { headers: await authHeaders() });
    if (res.ok) setMeta((await res.json()) as Meta);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 文面や対象を変えたらテスト済みの状態を解除する（テストしたものと違うものが飛ばないように）
  const invalidate = () => {
    setCampaignId(null);
    setTestedTo(null);
  };

  const count = meta ? meta.counts[audience] : 0;

  async function sendTest() {
    setBusy("test");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/email", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ mode: "test", subject, body, audience }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        campaignId?: string;
        testedTo?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMsg({ kind: "err", text: json.error ?? "テスト送信に失敗しました" });
        return;
      }
      setCampaignId(json.campaignId ?? null);
      setTestedTo(json.testedTo ?? null);
      setMsg({
        kind: "ok",
        text: `テスト送信しました（${json.testedTo}）。届いた内容を必ず確認してから本送信してください。`,
      });
    } finally {
      setBusy("");
    }
  }

  async function sendReal() {
    if (!campaignId) return;
    if (
      !window.confirm(
        `本当に ${count} 名へ送信します。\n\n件名: ${subject}\n\nこの操作は取り消せません。`,
      )
    )
      return;
    setBusy("send");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/email", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          mode: "send",
          subject,
          body,
          audience,
          campaignId,
          expectedCount: count,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        sent?: number;
        failed?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMsg({ kind: "err", text: json.error ?? "送信に失敗しました" });
        return;
      }
      setMsg({
        kind: "ok",
        text: `送信しました。成功 ${json.sent} 件 / 失敗 ${json.failed} 件`,
      });
      invalidate();
    } finally {
      setBusy("");
    }
  }

  if (!meta) return <p className="text-xs text-gray-500">読み込み中…</p>;

  if (!meta.ready) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-sm font-semibold text-red-300">送信できません</p>
        <p className="mt-1 text-xs text-gray-400 leading-relaxed">
          送信元（RESEND_FROM_EMAIL）または APIキー（RESEND_API_KEY）が設定されていません。
          共有のテスト用ドメインから送ると<strong>本人以外には届きません</strong>ので、
          設定されるまで送信を止めています。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-gray-400 space-y-1">
        <p>
          送信元 <span className="text-gray-200">{meta.from}</span>
        </p>
        <p>
          返信先{" "}
          <span className={meta.replyTo ? "text-gray-200" : "text-amber-300"}>
            {meta.replyTo ?? "未設定（返信が届きません）"}
          </span>
        </p>
        <p className="text-gray-500">
          Appleの非公開メール宛にも届くよう、自社ドメインから1通ずつ送ります（BCCは使いません）。
        </p>
      </div>

      <div>
        <label className="block text-[11px] text-gray-400 mb-1.5">送信対象</label>
        <div className="flex flex-wrap gap-2">
          {(["broadcasters", "paying", "all"] as Audience[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAudience(a);
                invalidate();
              }}
              className={`px-3 py-2 rounded-md border text-xs transition ${
                audience === a
                  ? "border-[#e63946] bg-[#e63946]/15 text-white"
                  : "border-white/15 bg-white/[0.03] text-gray-300 hover:bg-white/10"
              }`}
            >
              {meta.labels[a]}
              <span className="ml-1.5 tabular-nums text-gray-400">
                {meta.counts[a]}名
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-gray-400 mb-1.5">件名</label>
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            invalidate();
          }}
          maxLength={120}
          placeholder="例）アプリを最新版に更新してください"
          className="w-full h-10 rounded-md bg-white/[0.06] border border-white/10 px-3 text-sm outline-none focus:border-white/30"
        />
      </div>

      <div>
        <label className="block text-[11px] text-gray-400 mb-1.5">本文</label>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            invalidate();
          }}
          rows={16}
          placeholder="空行で段落が分かれます。"
          className="w-full rounded-md bg-white/[0.06] border border-white/10 p-3 text-sm leading-relaxed outline-none focus:border-white/30 font-mono"
        />
      </div>

      {msg && (
        <p
          className={`text-xs rounded-md px-3 py-2 ${
            msg.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
              : "bg-red-500/10 text-red-300 border border-red-500/20"
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={sendTest}
          disabled={!subject.trim() || !body.trim() || busy !== ""}
          className="h-10 px-4 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition"
        >
          {busy === "test" ? "送信中…" : "① 自分にテスト送信"}
        </button>
        <button
          type="button"
          onClick={sendReal}
          disabled={!campaignId || busy !== ""}
          className="h-10 px-4 rounded-md bg-[#e63946] hover:bg-[#d62836] disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold transition"
        >
          {busy === "send" ? "送信中…" : `② ${count}名へ本送信`}
        </button>
      </div>

      {!campaignId && (
        <p className="text-[11px] text-gray-500">
          本送信は、テスト送信を済ませると押せるようになります。
          文面や対象を変更すると、もう一度テスト送信が必要です。
        </p>
      )}
      {testedTo && (
        <p className="text-[11px] text-emerald-400/80">
          テスト済み（{testedTo}）。内容を確認してから ② を押してください。
        </p>
      )}
    </div>
  );
}
