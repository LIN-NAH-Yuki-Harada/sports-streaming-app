"use client";

import { usePathname } from "next/navigation";

export function BottomNav() {
  const pathname = usePathname();

  // LP・法的ページではボトムナビを非表示
  const hiddenPaths = ["/lp", "/terms", "/privacy", "/contact"];
  if (hiddenPaths.some((path) => pathname.startsWith(path))) return null;

  const tabs = [
    {
      href: "/",
      label: "ホーム",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
        </svg>
      ),
    },
    {
      href: "/search",
      label: "さがす",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
    },
    {
      href: "/broadcast",
      label: "配信",
      special: true,
      icon: (
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8" />
        </svg>
      ),
    },
    {
      href: "/schedule",
      label: "予定",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      href: "/mypage",
      label: "マイページ",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-[#111]/95 backdrop-blur-md border-t border-white/5">
      <div className="mx-auto max-w-lg flex items-center justify-around py-2">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <a
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 ${
                tab.special
                  ? ""
                  : active
                    ? "text-white"
                    : "text-gray-500"
              }`}
            >
              {tab.special ? (
                <div className="w-9 h-9 -mt-4 rounded-full bg-[#e63946] flex items-center justify-center shadow-lg shadow-[#e63946]/20">
                  {tab.icon}
                </div>
              ) : (
                tab.icon
              )}
              <span
                className={`text-[10px] ${
                  tab.special ? "text-[#e63946] -mt-0.5" : ""
                }`}
              >
                {tab.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
