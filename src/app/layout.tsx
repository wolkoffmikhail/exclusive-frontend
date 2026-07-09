import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Инвестиционный портфель",
    template: "%s · Инвестиционный портфель",
  },
  description: "Учёт, консолидация и анализ семейного инвестиционного портфеля",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
