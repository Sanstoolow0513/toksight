import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata = {
  title: "toksight · AI agent token 用量仪表盘",
  description:
    "Local-first token usage, cost and cache hit rate dashboard for AI coding agents.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
