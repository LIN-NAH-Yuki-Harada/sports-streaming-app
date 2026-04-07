export default function MyPage() {
  const menuItems = [
    { label: "お気に入りチーム", ready: false },
    { label: "視聴履歴", ready: false },
    { label: "配信履歴", ready: false },
    { label: "サブスクリプション", ready: false },
    { label: "通知設定", ready: false },
    { label: "ヘルプ", ready: false },
  ];

  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pt-4 pb-3">
        <h1 className="text-sm font-bold">マイページ</h1>
      </div>

      <div className="px-5 pt-4 pb-20">
        {/* プロフィール */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center text-gray-600 text-sm">
            ?
          </div>
          <div>
            <p className="text-sm font-medium text-gray-400">
              ログインしていません
            </p>
            <p className="text-[10px] text-gray-600">
              ログインするとお気に入りチームや配信履歴が使えます
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <button className="w-full flex items-center justify-center gap-3 bg-white text-black text-sm font-semibold py-2.5 rounded-md hover:bg-gray-200 transition">
            <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Googleでログイン
          </button>
          <button className="w-full flex items-center justify-center gap-3 bg-[#06C755] text-white text-sm font-semibold py-2.5 rounded-md hover:bg-[#05b34c] transition">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.67 1.35 5.04 3.46 6.62-.05.46-.31 1.72-.35 1.99-.06.36.13.36.27.26.1-.07 1.62-1.07 2.28-1.51.72.2 1.49.32 2.29.35L12 18.2c.08 0 .16 0 .24-.01 5.38-.18 9.76-3.93 9.76-8.49C22 5.82 17.52 2 12 2z"/></svg>
            LINEでログイン
          </button>
          <button className="w-full flex items-center justify-center gap-3 bg-[#1877F2] text-white text-sm font-semibold py-2.5 rounded-md hover:bg-[#1565c0] transition">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Facebookでログイン
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-gray-600">または</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <button className="mt-4 w-full flex items-center justify-center gap-2 border border-white/10 text-gray-300 text-sm font-semibold py-2.5 rounded-md hover:bg-white/5 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          メールアドレスで新規登録
        </button>

        {/* メニュー */}
        <div className="mt-8 space-y-1">
          {menuItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between py-3 border-b border-white/5 text-sm"
            >
              <span className="text-gray-400">{item.label}</span>
              <span className="text-[10px] text-gray-700">準備中</span>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-[10px] text-gray-700">
          LIVE SPOtCH v0.1.0 (MVP)
        </p>
      </div>
    </div>
  );
}
