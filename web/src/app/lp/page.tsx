import Image from "next/image";

export default function LandingPage() {
  return (
    <div>
      {/* LP専用ヘッダー */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8 py-3">
          <a href="/lp" className="flex items-center gap-2">
            <span className="bg-[#e63946] text-white text-xs font-black px-1.5 py-0.5 rounded tracking-wider">
              LIVE
            </span>
            <span className="text-base font-bold tracking-tight">LIVE SPOtCH</span>
          </a>
          {/* PC用ナビ */}
          <div className="hidden sm:flex items-center gap-6 text-[13px]">
            <a href="#features" className="text-gray-400 hover:text-white transition">特徴</a>
            <a href="#how" className="text-gray-400 hover:text-white transition">使い方</a>
            <a href="#pricing" className="text-gray-400 hover:text-white transition">料金</a>
            <a
              href="/"
              className="bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-4 py-1.5 rounded-md transition"
            >
              アプリを開く
            </a>
          </div>
          {/* スマホ用ボタン */}
          <a
            href="/"
            className="sm:hidden bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-3 py-1.5 rounded-md transition"
          >
            アプリを開く
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] sm:w-[600px] h-[300px] sm:h-[400px] bg-[#e63946]/10 rounded-full blur-[120px]" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 lg:pt-32 pb-16 sm:pb-24">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <p className="text-[#e63946] text-xs sm:text-sm font-medium tracking-wide mb-3 sm:mb-4">
                誰もがスポーツ中継のカメラマン。手元のスマホが機材になる。
              </p>
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black leading-[1.1] tracking-tight">
                子どもの試合を、
                <br />
                どこにいても見届ける。
              </h1>
              <p className="mt-4 sm:mt-6 text-gray-500 text-sm sm:text-base max-w-lg leading-relaxed">
                スポーツ少年団の大会、部活の公式戦、地域リーグ。
                共有コードひとつで、チームの関係者だけがリアルタイム観戦。
              </p>

              {/* 安心感バッジ */}
              <div className="mt-5 sm:mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1 text-[11px] text-gray-300">
                  <span aria-hidden="true">🔒</span> 限定公開なので安心
                </span>
                <span className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1 text-[11px] text-gray-300">
                  <span aria-hidden="true">⚡</span> 低遅延 0.25秒
                </span>
                <span className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1 text-[11px] text-gray-300">
                  <span aria-hidden="true">📺</span> TV中継品質のスコアボード
                </span>
              </div>

              <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <a
                  href="/"
                  className="bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold px-6 py-3 rounded-md transition w-full sm:w-auto text-center"
                >
                  まずは10分間、無料で試す
                </a>
                <span className="text-sm text-gray-600 px-4 py-3">
                  Webブラウザで今すぐ使えます
                </span>
              </div>
            </div>

            {/* 配信画面プレビュー（実写映像 + CSSオーバーレイ） */}
            <div className="relative mx-auto w-full max-w-sm lg:max-w-none aspect-[9/16] lg:aspect-[4/5] max-h-[500px] rounded-2xl overflow-hidden border border-white/10 shadow-2xl" aria-hidden="true">
              <Image
                src="/lp-hero-soccer.jpg"
                alt=""
                fill
                sizes="(max-width: 1024px) 384px, 500px"
                className="object-cover object-center"
                priority
              />
              {/* UI 視認性確保のための薄い暗幕 */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/50" />
              {/* 左上: スコアボード */}
              <div className="absolute top-3 left-3 flex items-center bg-black/70 backdrop-blur-sm rounded overflow-hidden text-[10px]">
                <div className="px-2 py-1 bg-white/10 font-bold">港FC</div>
                <div className="flex items-center gap-0.5 px-3 py-1 bg-[#e63946]">
                  <span className="font-black tabular-nums">3</span>
                  <span className="text-[8px] text-white/60">-</span>
                  <span className="font-black tabular-nums">1</span>
                </div>
                <div className="px-2 py-1 bg-white/10 font-bold">南FC</div>
                <div className="px-2 py-1 bg-black/60">
                  <span className="tabular-nums">前半</span>
                </div>
              </div>
              {/* 右上: LIVE */}
              <div className="absolute top-3 right-3 flex items-center gap-1 bg-[#e63946] px-2 py-1 rounded text-[9px] font-bold">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                </span>
                LIVE
              </div>
              {/* 下部: 視聴者数 */}
              <div className="absolute top-14 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
                <span className="text-[9px] text-gray-300 font-medium">👀 12人が視聴中</span>
              </div>
              {/* 左下: 共有コード */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded px-2.5 py-1.5">
                <span className="text-[8px] text-gray-400">コード</span>
                <span className="text-[10px] font-black tracking-widest">A8C3</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 使い方：3ステップ */}
      <section id="how" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h2 className="text-lg font-bold mb-6 sm:mb-8">かんたん3ステップ</h2>
        <div className="grid gap-4 sm:gap-6 lg:gap-8 grid-cols-1 sm:grid-cols-3">
          {[
            { step: "STEP 1", title: "アプリに登録して配信開始", desc: "無料で会員登録。チーム名を入れたら、初回10分間は無料で配信できます。", image: "/lp-hero-soccer.jpg" },
            { step: "STEP 2", title: "共有コードをLINEで送る", desc: "配信が始まると共有コードを自動発行。チームのLINEグループに送るだけ。", image: "/lp-steps-line-share.jpg" },
            { step: "STEP 3", title: "家族がどこからでも無料で観戦", desc: "コードを受け取った人はアプリ登録するだけ。視聴は完全無料。スコアボード付きのTV中継品質。", image: "/lp-steps-family-watch.jpg" },
          ].map((item) => (
            <div key={item.step} className="rounded-lg bg-[#111] border border-white/5 overflow-hidden">
              <div className="relative aspect-[16/10] w-full">
                <Image src={item.image} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 33vw" />
              </div>
              <div className="p-5 sm:p-6">
                <span className="text-[#e63946] text-xs font-bold">{item.step}</span>
                <h3 className="text-sm sm:text-base font-semibold mt-2 mb-1">{item.title}</h3>
                <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 対応スポーツ */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-sm sm:text-base font-semibold text-gray-300 mb-4 sm:mb-6">あらゆるスポーツに対応</h2>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {[
            { emoji: "⚽", name: "サッカー" },
            { emoji: "⚾", name: "野球" },
            { emoji: "🏀", name: "バスケ" },
            { emoji: "🏐", name: "バレー" },
            { emoji: "🏃", name: "陸上" },
            { emoji: "🎾", name: "テニス" },
            { emoji: "🏓", name: "卓球" },
            { emoji: "🏊", name: "水泳" },
            { emoji: "🏉", name: "ラグビー" },
            { emoji: "🤾", name: "ハンドボール" },
          ].map((s) => (
            <span key={s.name} className="text-xs sm:text-sm text-gray-400 bg-white/5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-md">
              {s.emoji} {s.name}
            </span>
          ))}
          <span className="text-xs sm:text-sm text-gray-600 px-3 sm:px-4 py-1.5 sm:py-2">...その他すべてのスポーツ</span>
        </div>
      </section>

      {/* 特徴 */}
      <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-lg font-bold mb-6 sm:mb-8">YouTubeではできないこと</h2>
        <div className="grid gap-6 sm:gap-8 lg:gap-12 grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[#e63946] text-xl sm:text-2xl font-black mb-2">0.25秒</p>
            <p className="text-xs sm:text-sm font-medium mb-1">超低遅延</p>
            <p className="text-[11px] sm:text-xs text-gray-500 leading-relaxed">
              テレビ放送より速い。ゴールの瞬間を、離れた家族とほぼ同時に。
            </p>
          </div>
          <div>
            <p className="text-[#e63946] text-xl sm:text-2xl font-black mb-2">TV品質</p>
            <p className="text-xs sm:text-sm font-medium mb-1">スコアボード常時表示</p>
            <p className="text-[11px] sm:text-xs text-gray-500 leading-relaxed">
              チーム名、スコア、時間をオーバーレイ。映像を遮ることなく試合情報が届く。
            </p>
          </div>
          <div>
            <p className="text-[#e63946] text-xl sm:text-2xl font-black mb-2">限定公開</p>
            <p className="text-xs sm:text-sm font-medium mb-1">プライバシーを守る</p>
            <p className="text-[11px] sm:text-xs text-gray-500 leading-relaxed">
              共有コードを持つ人だけが視聴可能。お子さまの映像が不特定多数に公開されません。
            </p>
          </div>
          <div>
            <p className="text-[#e63946] text-xl sm:text-2xl font-black mb-2">視聴無料</p>
            <p className="text-xs sm:text-sm font-medium mb-1">家族はタダで観戦</p>
            <p className="text-[11px] sm:text-xs text-gray-500 leading-relaxed">
              見る人は完全無料。コードを受け取ったらすぐに観戦できます。
            </p>
          </div>
        </div>
      </section>

      {/* こんなときに使えます */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-lg font-bold mb-6 sm:mb-8">こんなときに使えます</h2>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
          {[
            { title: "試合に行けない日に", desc: "仕事で応援に行けなくても、スマホでリアルタイム観戦。お子さまの活躍を見逃しません。", image: "/lp-scenes-office-dad.jpg" },
            { title: "おじいちゃん、おばあちゃんに", desc: "遠方に住む祖父母にもコードを送るだけ。孫の試合を一緒に応援。", image: "/lp-scenes-grandparents.jpg" },
            { title: "チームの振り返りに", desc: "アーカイブを活用して、試合後の反省会や戦術確認に。コーチも選手も使えます。", image: "/lp-scenes-coach-review.jpg" },
            { title: "大会・講演会の中継に", desc: "スポーツに限らず、学校行事や講演会の限定配信にも対応。", image: "/lp-scenes-school-event.jpg" },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-white/5 overflow-hidden bg-[#0f0f0f]">
              <div className="relative aspect-[4/3] w-full">
                <Image src={item.image} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 50vw" />
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold mb-1">{item.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* こんなチームに使われています */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-lg font-bold mb-4 sm:mb-6">こんなチームに使われています</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {[
            { title: "⚽ スポーツ少年団", desc: "地域の大会・練習試合を保護者がスマホで配信。試合に来れない家族もリアルタイムで応援。", image: "/lp-hero-soccer.jpg" },
            { title: "🏐 中学校・高校の部活", desc: "公式戦の模様をOB/OGや保護者に限定配信。スコアボードで試合展開も一目瞭然。", image: "/lp-teams-junior-volleyball.jpg" },
            { title: "🏆 地域リーグ・ローカル大会", desc: "メディアが来ない地域の試合も、チーム関係者だけのプライベート中継で盛り上がる。", image: "/lp-teams-local-adult.jpg" },
          ].map((item) => (
            <div key={item.title} className="relative rounded-lg border border-white/5 overflow-hidden aspect-[4/3]">
              <Image src={item.image} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 33vw" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/20" />
              <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                <p className="text-sm font-semibold mb-1">{item.title}</p>
                <p className="text-xs text-gray-200 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 保護者の声 */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-lg font-bold mb-6 sm:mb-8">保護者・コーチの声</h2>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3">
          {[
            {
              voice: "「土曜の大会、祖父母にも見せられて本当に嬉しかった。シニア世代にも簡単に使えるのが◎」",
              name: "小学生サッカーの保護者",
              role: "スポーツ少年団",
            },
            {
              voice: "「スコアボードが映るだけで、見ている側の熱量が全然違う。応援LINEがこれまでの倍来るようになった」",
              name: "中学バレー部コーチ",
              role: "部活動",
            },
            {
              voice: "「試合に来られない遠方の親戚にも、その場の空気を届けられる。『行った気になれる』のがいい」",
              name: "保護者会メンバー",
              role: "地域リーグ",
            },
          ].map((v, i) => (
            <div key={i} className="rounded-lg bg-[#111] border border-white/5 p-5 sm:p-6">
              <div className="text-[#e63946] text-xl leading-none mb-3" aria-hidden="true">“</div>
              <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">{v.voice}</p>
              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-[11px] font-semibold text-gray-400">{v.name}</p>
                <p className="text-[10px] text-gray-600 mt-0.5">{v.role}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[10px] text-gray-600 text-center">
          ※ 想定される利用シーンの声です。実際のユーザーの声は随時掲載予定です。
        </p>
      </section>

      {/* 料金 */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-lg font-bold mb-6 sm:mb-8">料金</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 max-w-4xl mx-auto">
          <div className="rounded-lg border border-white/10 p-5 sm:p-6">
            <p className="text-xs text-gray-500 mb-1">視聴する人</p>
            <p className="text-2xl sm:text-3xl font-black">無料</p>
            <p className="text-xs text-gray-500 mt-3 leading-relaxed">
              共有コードで配信・アーカイブを視聴。
            </p>
            <ul className="mt-3 space-y-1.5 text-[11px] sm:text-xs text-gray-500">
              <li>✓ ライブ視聴</li>
              <li>✓ 1ヶ月以内のアーカイブ視聴</li>
            </ul>
          </div>
          <div className="rounded-lg border border-[#e63946]/30 bg-[#e63946]/5 p-5 sm:p-6">
            <p className="text-xs text-[#e63946] mb-1">配信者プラン</p>
            <p className="text-2xl sm:text-3xl font-black">¥300<span className="text-sm font-normal text-gray-400">/月</span></p>
            <p className="text-xs text-gray-400 mt-1">初回10分間は無料でお試し</p>
            <ul className="mt-3 space-y-1.5 text-[11px] sm:text-xs text-gray-400">
              <li>✓ ライブ配信</li>
              <li>✓ スコアボード・オーバーレイ</li>
              <li>✓ LINE共有（ワンタップ）</li>
              <li>✓ アーカイブ自動保存</li>
            </ul>
          </div>
          <div className="rounded-lg border border-white/20 bg-white/5 p-5 sm:p-6">
            <p className="text-xs text-white mb-1">チームプラン</p>
            <p className="text-2xl sm:text-3xl font-black">¥500<span className="text-sm font-normal text-gray-400">/月</span></p>
            <p className="text-xs text-gray-400 mt-1">配信者プランの全機能 +</p>
            <ul className="mt-3 space-y-1.5 text-[11px] sm:text-xs text-gray-400">
              <li>✓ チーム管理・メンバー招待</li>
              <li>✓ YouTube自動アーカイブ</li>
              <li>✓ スケジュール管理</li>
              <li className="text-gray-600">✓ AIハイライト自動生成（近日）</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-white/5">
        <h2 className="text-lg font-bold mb-6 sm:mb-8">よくある質問</h2>
        <div className="space-y-3">
          {[
            {
              q: "子どもの顔が映るのが心配です。大丈夫ですか？",
              a: "共有コードを知る人だけが視聴できる限定公開なので、ご家族・チーム関係者以外には配信は届きません。アーカイブも同様です。",
            },
            {
              q: "配信の画質はどれくらいですか？",
              a: "HD画質(1280x720)・1.5Mbpsで配信しています。一般的なLTE回線・WiFi環境で安定して視聴できます。",
            },
            {
              q: "10分の無料お試し時間が終わったらどうなりますか？",
              a: "そこまでは完全無料で配信できます。続けて配信したい場合は、配信者プラン（¥300/月）にご登録ください。いつでも解約できます。",
            },
            {
              q: "複数の家族・親戚が同時に視聴できますか？",
              a: "人数制限はありません。共有コードさえお持ちなら、何人でも同時に視聴いただけます。",
            },
            {
              q: "視聴する側も料金はかかりますか？",
              a: "視聴は完全無料です。共有コードを受け取ったら、アカウント登録するだけですぐに観戦できます。",
            },
            {
              q: "アプリのダウンロードは必要ですか？",
              a: "不要です。Webブラウザからアクセスできます。スマホのホーム画面に追加すれば、アプリと同じように使えます。",
            },
            {
              q: "解約はかんたんにできますか？",
              a: "マイページの「プラン管理」からいつでも解約できます。解約後も当該月末まではご利用可能です。",
            },
          ].map((faq, i) => (
            <details
              key={i}
              className="group rounded-lg bg-[#111] border border-white/5 open:border-white/10 transition"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer px-4 sm:px-5 py-3 sm:py-4 list-none">
                <span className="text-xs sm:text-sm font-semibold text-gray-200">{faq.q}</span>
                <span
                  className="text-xs text-gray-500 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                >
                  ▼
                </span>
              </summary>
              <div className="px-4 sm:px-5 pb-3 sm:pb-4 text-xs sm:text-sm text-gray-400 leading-relaxed">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-white/5">
        <div className="absolute inset-0">
          <Image
            src="/lp-cta-emotional.jpg"
            alt=""
            fill
            className="object-cover object-[25%_30%]"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/30" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-32">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl lg:text-5xl font-black leading-tight drop-shadow-lg">
              その一瞬の感動を手のひらに。
            </h2>
            <p className="mt-4 text-sm sm:text-base text-gray-100">
              会場に行けない日でも、成長の瞬間を見逃さない。
            </p>
            <a
              href="/"
              className="inline-block mt-8 sm:mt-10 bg-[#e63946] hover:bg-[#d62836] text-white text-sm sm:text-base font-semibold px-8 py-3 sm:px-10 sm:py-4 rounded-md transition shadow-2xl shadow-red-900/40"
            >
              まずは10分間、無料で試す
            </a>
            <p className="mt-4 text-[10px] sm:text-xs text-gray-300">
              Webブラウザで今すぐ使えます / ホーム画面に追加でアプリ感覚
            </p>
          </div>
        </div>
      </section>

      {/* フッター */}
      <footer className="border-t border-white/5 py-6 sm:py-8 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-600">
          <p>© 2026 LIVE SPOtCH / LIN-NAH株式会社</p>
          <div className="flex gap-4 sm:gap-6">
            <a href="/terms" className="hover:text-gray-400 transition">利用規約</a>
            <a href="/privacy" className="hover:text-gray-400 transition">プライバシーポリシー</a>
            <a href="/contact" className="hover:text-gray-400 transition">お問い合わせ</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
