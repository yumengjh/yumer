import type { Metadata, Viewport } from "next";
import { ConfigProvider } from "antd";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { editorTheme } from "@/theme";
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
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider theme={editorTheme}>
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
