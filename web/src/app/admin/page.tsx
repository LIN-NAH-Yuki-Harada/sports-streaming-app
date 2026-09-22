import Link from "next/link";
import { getAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * 管理ダッシュボード。
 *
 * ★何を見せる画面か（2026-09-23 改訂）
 *   「今、手を打つべきことはあるか」を数秒で判断できることだけを目的にする。
 *   詳しい数字は各ページ（成長・PL・配信…）にあるので、ここでは重複させない。
 *
 * ★なぜアーカイブの節を足したか
 *   同日、映像の変換を配信サーバー(1台目)から**アーカイブ専用機(2台目)へ完全に移した**。
 *   1台目は配信を受けることに専念し、変換には一切触らない。
 *   構成としては正しいが、**2台目が倒れても画面にエラーは出ない**という弱点がある。
 *   配信は普通にできて、視聴もでき、ただ「アーカイブだけが増えなくなる」。
 *   そして録画は 48 時間で自動削除されるので、**気づくのが遅れると本当に消える**。
 *
 *   そこで「最後にアーカイブが完了した時刻」を 2台目の心拍として扱う。
 *   処理待ちがあるのに完了が途絶えていれば、2台目に何か起きている。
 */

// 待ちがあるのにこの時間だけ完了が無い → 2台目の異常を疑う
const STALL_WARN_MIN = 30;
// 1本あたりの待ち時間がこれを超えたら、混雑か異常
const WAIT_WARN_MIN = 60;

function jstDayStartIso(): string {
  // Vercel は UTC で動くので、JST の「今日0時」を自分で出す。
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = nowJst.getUTCFullYear();
  const m = nowJst.getUTCMonth();
  const d = nowJst.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 9 * 60 * 60 * 1000).toISOString();
}

function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 60000) : null;
}

function fmtJstTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminDashboard() {
  const admin = getAdminClient();
  const dayStart = jstDayStartIso();

  const [
    liveRes,
    todayRes,
    usersRes,
    openReportsRes,
    queueRes,
    lastDoneRes,
    todayDoneRes,
    todayFailedRes,
  ] = await Promise.all([
    admin
      .from("broadcasts")
      .select("id", { count: "exact", head: true })
      .eq("status", "live"),
    admin
      .from("broadcasts")
      .select("id", { count: "exact", head: true })
      .gte("started_at", dayStart),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    // 変換待ちの行。ワーカーの取得条件とそろえる（worker.js の SELECT と同じ形）。
    admin
      .from("broadcasts")
      .select("ended_at", { count: "exact" })
      .eq("status", "ended")
      .not("stream_playback_url", "is", null)
      .or("youtube_upload_status.is.null,youtube_upload_status.eq.pending")
      .order("ended_at", { ascending: true })
      .limit(1),
    // ★2台目の心拍。最後にアーカイブが完了した時刻。
    admin
      .from("broadcasts")
      .select("youtube_upload_completed_at")
      .not("youtube_upload_completed_at", "is", null)
      .order("youtube_upload_completed_at", { ascending: false })
      .limit(1),
    admin
      .from("broadcasts")
      .select("id", { count: "exact", head: true })
      .eq("youtube_upload_status", "completed")
      .gte("youtube_upload_completed_at", dayStart),
    admin
      .from("broadcasts")
      .select("id", { count: "exact", head: true })
      .eq("youtube_upload_status", "failed")
      .gte("started_at", dayStart),
  ]);

  const liveCount = liveRes.count ?? 0;
  const openReports = openReportsRes.count ?? 0;
  const queueCount = queueRes.count ?? 0;
  const oldestWaitMin = minutesSince(queueRes.data?.[0]?.ended_at);
  const lastDoneAt = lastDoneRes.data?.[0]?.youtube_upload_completed_at ?? null;
  const lastDoneMin = minutesSince(lastDoneAt);
  const todayDone = todayDoneRes.count ?? 0;
  const todayFailed = todayFailedRes.count ?? 0;

  // アーカイブの健康判定。
  //   待ちが無ければ、完了が古くても正常（単に仕事が無いだけ）。
  //   待ちがあるのに完了が途絶えている＝2台目が動いていない疑い。
  const stalled =
    queueCount > 0 && (lastDoneMin === null || lastDoneMin > STALL_WARN_MIN);
  const waitingLong = oldestWaitMin !== null && oldestWaitMin > WAIT_WARN_MIN;
  const archiveState: "ok" | "busy" | "warn" = stalled
    ? "warn"
    : waitingLong
      ? "busy"
      : "ok";

  const cards = [
    { label: "LIVE配信中", value: liveCount, href: "/admin/broadcasts" },
    {
      label: "本日の配信",
      value: todayRes.count ?? 0,
      href: "/admin/broadcasts",
    },
    { label: "会員数", value: usersRes.count ?? 0, href: "/admin/users" },
    {
      label: "未対応の通報",
      value: openReports,
      href: "/admin/reports",
      alert: openReports > 0,
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">ダッシュボード</h1>
      <p className="text-xs text-gray-500 mb-4">
        「いま手を打つべきことがあるか」だけを見る画面です。詳しい数字は各ページに置いています。
      </p>

      {/* 1. いまの状態 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`rounded-xl border p-4 transition hover:border-white/25 ${
              c.alert
                ? "border-[#e63946]/50 bg-[#e63946]/10"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="text-xs text-gray-400">{c.label}</div>
            <div className="text-3xl font-black tabular-nums mt-1">
              {c.value}
            </div>
          </Link>
        ))}
      </div>

      {/* 2. アーカイブの健康状態（2台目の生死をここで見る） */}
      <section className="mt-6">
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-sm font-bold">アーカイブ処理</h2>
          <span className="text-[11px] text-gray-500">
            変換は2台目（アーカイブ専用機）が行います
          </span>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            archiveState === "warn"
              ? "border-[#e63946]/50 bg-[#e63946]/10"
              : archiveState === "busy"
                ? "border-amber-400/40 bg-amber-400/10"
                : "border-white/10 bg-white/[0.03]"
          }`}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-400">処理待ち</div>
              <div className="text-2xl font-black tabular-nums">
                {queueCount}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">いちばん古い待ち</div>
              <div className="text-2xl font-black tabular-nums">
                {oldestWaitMin === null ? "—" : `${oldestWaitMin}分`}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">最後に完了</div>
              <div className="text-2xl font-black tabular-nums">
                {fmtJstTime(lastDoneAt)}
              </div>
              <div className="text-[11px] text-gray-500">
                {lastDoneMin === null ? "記録なし" : `${lastDoneMin}分前`}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">本日</div>
              <div className="text-2xl font-black tabular-nums">
                {todayDone}
                <span className="text-sm font-normal text-gray-400">
                  {" "}
                  件完了
                </span>
              </div>
              {todayFailed > 0 && (
                <div className="text-[11px] text-[#e63946]">
                  失敗 {todayFailed} 件
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-gray-300">
            {archiveState === "warn" ? (
              <>
                ⚠️{" "}
                <strong>
                  処理待ちがあるのに、30分以上どれも完了していません。
                </strong>
                <br />
                アーカイブ専用機（2台目）が止まっている可能性があります。
                <strong>録画は48時間で自動削除される</strong>
                ので、今日中に確認してください。
                配信・視聴そのものには影響していません。
              </>
            ) : archiveState === "busy" ? (
              <>
                混雑しています（いちばん古い待ちが1時間超）。試合が重なる日は正常な範囲ですが、
                このまま伸び続けるようなら2台目を確認してください。
              </>
            ) : queueCount === 0 ? (
              <>すべて処理済みです。</>
            ) : (
              <>順番に処理中です。</>
            )}
          </p>
        </div>

        {archiveState === "warn" && (
          <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[11px] text-gray-400 mb-1">
              復旧の手順（録画が残っている48時間以内なら取り返せます）
            </p>
            <code className="block text-[11px] text-gray-200 break-all">
              ssh livespotch-archive &apos;systemctl status
              archive-worker.timer; journalctl -u archive-worker --since
              &quot;-1h&quot; --no-pager | tail -20&apos;
            </code>
            <p className="text-[11px] text-gray-400 mt-2">
              2台目が復旧しない場合は、配信サーバー（1台目）に変換を戻せます。
            </p>
            <code className="block text-[11px] text-gray-200 break-all">
              ssh livespotch-vps &apos;sed -i
              &quot;s/^ARCHIVE_PROCESSING_ENABLED=.*/ARCHIVE_PROCESSING_ENABLED=1/&quot;
              /opt/archive-worker/.env&apos;
            </code>
          </div>
        )}
      </section>

      {/* 3. いまの構成（今日の変更を忘れないための覚書） */}
      <section className="mt-6">
        <h2 className="text-sm font-bold mb-2">いまの構成</h2>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[11px] leading-relaxed text-gray-300">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="font-bold text-white mb-1">
                1台目 ／ 配信サーバー
              </div>
              配信を受け取り、録画し、監視する。
              <strong>映像の変換はしません。</strong>
              <br />
              <span className="text-gray-500">
                変換は一度始まると止まらず、配信と食い合うため（2026-09-20
                に負荷220%）
              </span>
            </div>
            <div>
              <div className="font-bold text-white mb-1">
                2台目 ／ アーカイブ専用機
              </div>
              1台目の録画を読み、スコアボードを焼き込んで YouTube へ上げる。
              <br />
              <span className="text-gray-500">
                配信を受けないので、全力で処理できる
              </span>
            </div>
          </div>
          <p className="mt-3 text-gray-500">
            録画は1台目に48時間残ります。2台目が倒れても映像はすぐには消えないので、
            気づいてから戻せば取り返せます。
          </p>
        </div>
      </section>

      <p className="text-xs text-gray-500 mt-8">
        サーバーの負荷グラフは{" "}
        <Link href="/admin/server" className="text-[#e63946] hover:underline">
          サーバー
        </Link>
        、売上と費用は{" "}
        <Link href="/admin/pl" className="text-[#e63946] hover:underline">
          PL
        </Link>
        、会員の伸びは{" "}
        <Link href="/admin/growth" className="text-[#e63946] hover:underline">
          成長
        </Link>
        にあります。
      </p>
    </div>
  );
}
