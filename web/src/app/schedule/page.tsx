export default function SchedulePage() {
  const days = [
    {
      date: "4/7 (月) 今日",
      matches: [
        { time: "14:00", sport: "サッカー", home: "明星SC", away: "光が丘FC", tournament: "練馬区4年生大会" },
        { time: "15:30", sport: "バスケ", home: "桜台ミニバス", away: "石神井クラブ", tournament: "練習試合" },
        { time: "16:00", sport: "野球", home: "大泉ジュニア", away: "関町イーグルス", tournament: "区少年野球秋季" },
      ],
    },
    {
      date: "4/8 (火)",
      matches: [
        { time: "10:00", sport: "バレー", home: "開進二中", away: "練馬東中", tournament: "区中学春季大会" },
        { time: "13:00", sport: "サッカー", home: "大泉学園SC", away: "田柄FC", tournament: "5年生リーグ" },
      ],
    },
    {
      date: "4/9 (水)",
      matches: [
        { time: "15:00", sport: "野球", home: "光が丘リトル", away: "石神井ファイターズ", tournament: "練習試合" },
      ],
    },
  ];

  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 pt-4 pb-3">
        <h1 className="text-sm font-bold">試合予定</h1>
      </div>

      <div className="px-5 pb-20">
        {days.map((day) => (
          <div key={day.date} className="mt-6 first:mt-2">
            <h2 className="text-[11px] text-gray-500 font-medium mb-2">
              {day.date}
            </h2>
            <div className="space-y-1.5">
              {day.matches.map((m) => (
                <div
                  key={m.home + m.time}
                  className="flex items-center gap-3 rounded-md bg-[#111] border border-white/5 px-3 py-2.5"
                >
                  <span className="text-[11px] text-gray-500 tabular-nums w-10 shrink-0">
                    {m.time}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {m.home} vs {m.away}
                    </p>
                    <p className="text-[9px] text-gray-600 truncate">
                      {m.sport} / {m.tournament}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
