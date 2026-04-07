export default function LPLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // アプリのボトムナビを非表示にする独立レイアウト
  return <>{children}</>;
}
