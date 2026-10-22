import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { THEME_BOOT_SCRIPT } from '@/lib/prefs';
import './globals.css';

export const metadata = {
  title: 'toksight · Token 用量与成本报告',
  description: 'Local-first token usage and cost report for AI coding agents.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
