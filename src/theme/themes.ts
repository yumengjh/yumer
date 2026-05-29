import type { ThemeConfig } from "antd";

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: "var(--color-primary)",
    colorLink: "var(--color-primary-text)",
    colorSuccess: "var(--color-success)",
    colorWarning: "var(--color-warning)",
    colorError: "var(--color-error)",
    colorInfo: "var(--color-info)",

    colorBgBase: "var(--color-bg)",
    colorBgContainer: "var(--color-bg-container)",
    colorBgElevated: "var(--color-bg-elevated)",
    colorBgLayout: "var(--color-bg-layout)",
    colorBgSpotlight: "var(--color-bg-spotlight)",
    colorBgMask: "var(--color-bg-mask)",

    colorText: "var(--color-text)",
    colorTextSecondary: "var(--color-text-secondary)",
    colorTextTertiary: "var(--color-text-tertiary)",
    colorTextQuaternary: "var(--color-text-quaternary)",
    colorTextInverse: "var(--color-text-inverse)",
    colorTextDisabled: "var(--color-text-disabled)",

    colorBorder: "var(--color-border)",
    colorBorderSecondary: "var(--color-border-secondary)",

    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    borderRadiusXS: 2,

    fontFamily: "var(--font-family)",
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,

    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,
  },
  components: {
    Button: {
      colorPrimary: "var(--color-primary)",
      algorithm: true,
    },
    Input: {
      colorBgContainer: "var(--input-bg)",
      colorBorder: "var(--input-border)",
      hoverBorderColor: "var(--input-hover-border)",
      activeBorderColor: "var(--input-focus-border)",
      activeShadow: "var(--input-focus-shadow)",
      colorTextPlaceholder: "var(--input-placeholder)",
      colorBgContainerDisabled: "var(--input-disabled-bg)",
    },
    Select: {
      colorBgContainer: "var(--input-bg)",
      colorBorder: "var(--input-border)",
      hoverBorderColor: "var(--input-hover-border)",
      optionSelectedBg: "var(--dropdown-item-active-bg)",
      optionActiveBg: "var(--dropdown-item-hover-bg)",
    },
    Dropdown: {
      colorBgElevated: "var(--dropdown-bg)",
      colorBorder: "var(--dropdown-border)",
      controlItemBgHover: "var(--dropdown-item-hover-bg)",
      controlItemBgActive: "var(--dropdown-item-active-bg)",
      boxShadow: "var(--dropdown-shadow)",
    },
    Modal: {
      contentBg: "var(--modal-bg)",
      headerBg: "var(--modal-bg)",
      titleColor: "var(--color-text)",
      colorIcon: "var(--color-text-secondary)",
      colorIconHover: "var(--color-text)",
      boxShadow: "var(--modal-shadow)",
    },
    Card: {
      colorBgContainer: "var(--card-bg)",
      colorBorderSecondary: "var(--card-border)",
      boxShadow: "var(--card-shadow)",
    },
    Table: {
      colorBgContainer: "var(--color-bg-container)",
      headerBg: "var(--color-bg-layout)",
      headerColor: "var(--color-text)",
      rowHoverBg: "var(--color-bg-hover)",
      borderColor: "var(--color-border-secondary)",
    },
    Menu: {
      colorBgContainer: "var(--color-bg-container)",
      colorItemBgSelected: "var(--sidebar-active-bg)",
      colorItemTextSelected: "var(--sidebar-active-text)",
      colorItemBgHover: "var(--sidebar-hover-bg)",
      colorActiveBarWidth: 0,
    },
    Tabs: {
      colorBgContainer: "var(--color-bg-container)",
      inkBarColor: "var(--color-primary)",
      itemActiveColor: "var(--color-primary)",
      itemHoverColor: "var(--color-primary-hover)",
      itemSelectedColor: "var(--color-primary)",
      cardBg: "var(--color-bg-container)",
    },
    Tooltip: {
      colorBgSpotlight: "var(--color-bg-spotlight)",
      colorTextLightSolid: "var(--color-text-inverse)",
    },
    Message: {
      contentBg: "var(--color-bg-elevated)",
    },
    Notification: {
      colorBgElevated: "var(--color-bg-elevated)",
    },
    Switch: {
      colorPrimary: "var(--color-primary)",
      colorPrimaryHover: "var(--color-primary-hover)",
    },
    Checkbox: {
      colorPrimary: "var(--color-primary)",
      colorPrimaryHover: "var(--color-primary-hover)",
    },
    Radio: {
      colorPrimary: "var(--color-primary)",
      colorPrimaryHover: "var(--color-primary-hover)",
    },
  },
};

export const darkTheme: ThemeConfig = {
  token: {
    ...lightTheme.token,
    colorBgBase: "var(--color-bg)",
  },
  components: {
    ...lightTheme.components,
  },
  algorithm: undefined,
};
