import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata = {
  title: "toksight · AI agent token 用量仪表盘",
  description:
    "Local-first token usage, cost and cache hit rate dashboard for AI coding agents.",
};

// Pre-paint theme bootstrap: resolves localStorage 'toksight-theme'
// (system|light|dark) against prefers-color-scheme and stamps data-theme on
// <html> before the first paint, so a dark preference never flashes light.
// Mirrors resolveTheme() in lib/theme.js — keep the two in sync.
const themeInit = `(function(){try{var t=localStorage.getItem('toksight-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
