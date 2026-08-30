import { MailComposer } from "./mail-composer";

export const dynamic = "force-dynamic";

export default function AdminEmail() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">一斉送信</h1>
      <p className="text-xs text-gray-500 mb-5 leading-relaxed">
        配信者や課金者へまとめてお知らせを送ります。BCC ではなく<strong className="text-gray-400">1通ずつ</strong>送るため、
        他の方のアドレスは見えません。<br />
        ★Apple の非公開メール（@privaterelay.appleid.com）には
        <strong className="text-gray-400">自社ドメインから送らないと届きません</strong>。
        Gmail から BCC で送ると、その方々には黙って破棄されます。
      </p>
      <MailComposer />
    </div>
  );
}
