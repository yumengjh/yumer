"use client";

import { ConfigProvider } from "antd";
import { useTheme } from "@/theme/ThemeContext";
import { lightTheme, darkTheme } from "@/theme/themes";

export function AntdThemeProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? darkTheme : lightTheme;

  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
