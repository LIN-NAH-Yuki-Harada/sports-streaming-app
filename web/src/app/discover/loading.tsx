import { Logo } from "@/components/logo";

// /discover は force-dynamic SSR で Supabase に複数クエリを投げるため
// 体感 2〜3 秒の空白が発生していた。loading.tsx を置くと Next.js が
// クリック直後にこの画面を即出ししてくれるので、LP からの遷移が
// 「固まった」ように見えなくなる。
export default function DiscoverLoading() {
  return (
    <div>
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <span className="text-xs text-gray-600">読み込み中…</span>
        </div>
      </div>
      <div className="flex items-center justify-center py-32">
        <div className="w-6 h-6 border-2 border-[#e63946] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
