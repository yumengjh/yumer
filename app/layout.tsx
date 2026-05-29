import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ThemeProvider } from "@/theme";
import { AntdThemeProvider } from "@/components/AntdThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Markdown Editor Demo",
  description: "Markdown enhanced rich text editor",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// 防止主题闪烁的脚本
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme') || 'system';
      var resolved = theme;
      if (theme === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.style.colorScheme = resolved;
    } catch (e) {}
  })()
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AntdRegistry>
          <ThemeProvider>
            <AntdThemeProvider>
              {children}
            </AntdThemeProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
