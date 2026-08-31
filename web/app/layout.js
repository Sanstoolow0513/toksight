import "./globals.css";

export const metadata = {
  title: "toksight · AI agent token 用量仪表盘",
  description:
    "Local-first token usage, cost and cache hit rate dashboard for AI coding agents.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
