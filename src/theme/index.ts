export { ThemeProvider, useTheme } from "./ThemeContext";
export type { ThemeMode } from "./ThemeContext";
export { lightTheme, darkTheme } from "./themes";

import type { ThemeConfig } from "antd";

export const COLORS = {
  primary: "var(--color-primary)",
  primaryHover: "var(--color-primary-hover)",
  primaryActive: "var(--color-primary-active)",
  primaryBg: "var(--color-primary-bg)",
  primaryBorder: "var(--color-primary-border)",
  primaryText: "var(--color-primary-text)",

  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",

  text: "var(--color-text)",
  textSecondary: "var(--color-text-secondary)",
  textTertiary: "var(--color-text-tertiary)",

  bg: "var(--color-bg)",
  bgLayout: "var(--color-bg-layout)",
  bgElevated: "var(--color-bg-elevated)",
  bgContainer: "var(--color-bg-container)",

  border: "var(--color-border)",
  borderSecondary: "var(--color-border-secondary)",

  toolbarBg: "var(--toolbar-bg)",
  toolbarBorder: "var(--toolbar-border)",
  toolbarText: "var(--toolbar-text)",
  toolbarTextMuted: "var(--toolbar-text-muted)",
  toolbarIcon: "var(--toolbar-icon)",
  toolbarIconHover: "var(--toolbar-icon-hover)",
  toolbarHoverBg: "var(--toolbar-hover-bg)",
  toolbarActiveBg: "var(--toolbar-active-bg)",
  toolbarActiveText: "var(--toolbar-active-text)",
} as const;

export const editorTheme: ThemeConfig = {
  token: {
    colorPrimary: COLORS.primary,
    colorLink: COLORS.primaryText,
    colorSuccess: COLORS.success,
    colorWarning: COLORS.warning,
    colorError: COLORS.error,

    colorBgContainer: COLORS.bgContainer,
    colorBgLayout: COLORS.bgLayout,
    colorBgElevated: COLORS.bgElevated,
    colorBorder: COLORS.border,
    colorBorderSecondary: COLORS.borderSecondary,
    colorText: COLORS.text,
    colorTextSecondary: COLORS.textSecondary,
    colorTextTertiary: COLORS.textTertiary,

    borderRadius: 6,
    fontFamily: "var(--font-family)",
  },
  components: {
    Dropdown: {
      colorBgElevated: "var(--dropdown-bg)",
      controlItemBgHover: "var(--dropdown-item-hover-bg)",
      controlItemBgActive: "var(--dropdown-item-active-bg)",
      colorText: COLORS.text,
      colorTextSecondary: COLORS.textSecondary,
    },
    Tooltip: {
      colorBgSpotlight: "var(--color-bg-spotlight)",
      colorTextLightSolid: "var(--color-text-inverse)",
    },
  },
};

export const toolbarTheme: ThemeConfig = {
  token: {
    colorPrimary: "var(--toolbar-active-text)",
    colorLink: "var(--toolbar-active-text)",
    colorBgContainer: "var(--toolbar-bg)",
    colorBgElevated: "var(--toolbar-bg)",
    colorBorder: "var(--toolbar-border)",
    colorText: "var(--toolbar-text)",
    colorTextSecondary: "var(--toolbar-text-muted)",
    colorTextTertiary: "var(--toolbar-text-muted)",
    controlItemBgHover: "var(--toolbar-hover-bg)",
    controlItemBgActive: "var(--toolbar-active-bg)",
  },
};
