import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ThemeProvider } from "@/theme";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AntdRegistry>
            <AntdThemeProvider>
              {children}
              <ThemeSwitcher />
            </AntdThemeProvider>
          </AntdRegistry>
        </ThemeProvider>
      </body>
    </html>
  );
}
