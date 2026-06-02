import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestaltung — Manufacturing, made simple in Qatar",
  description:
    "Gestaltung is a manufacturing marketplace and inventory platform for Qatar. Upload a CAD file, we match it to the right production method and partner workshop, and deliver the finished part.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
