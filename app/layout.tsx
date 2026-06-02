// Root layout is a pass-through. The real <html>/<body> live in
// app/[locale]/layout.tsx so that lang/dir can switch with the locale.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
