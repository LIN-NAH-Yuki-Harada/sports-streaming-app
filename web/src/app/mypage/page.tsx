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

        <button className="w-full bg-white text-black text-sm font-semibold py-2.5 rounded-md hover:bg-gray-200 transition">
          ログイン / 新規登録
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
