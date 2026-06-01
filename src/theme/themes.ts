import type { ThemeConfig } from "antd";

// 浅色主题配置
export const lightTheme: ThemeConfig = {
  token: {
    // 主色调
    colorPrimary: "#00b96b",
    colorLink: "#00b96b",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#ff4d4f",
    colorInfo: "#00b96b",

    // 背景色
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBgLayout: "#f5f5f5",
    colorBgSpotlight: "rgba(0, 0, 0, 0.85)",
    colorBgMask: "rgba(0, 0, 0, 0.45)",

    // 文字色
    colorText: "rgba(0, 0, 0, 0.88)",
    colorTextSecondary: "rgba(0, 0, 0, 0.65)",
    colorTextTertiary: "rgba(0, 0, 0, 0.45)",
    colorTextQuaternary: "rgba(0, 0, 0, 0.25)",
    colorTextDisabled: "rgba(0, 0, 0, 0.25)",

    // 边框色
    colorBorder: "#d9d9d9",
    colorBorderSecondary: "#f0f0f0",

    // 圆角
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    borderRadiusXS: 2,

    // 字体
    fontFamily: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,

    // 控件高度
    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,

    // 阴影
    boxShadow: "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
    boxShadowSecondary: "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
  },
  components: {
    // 按钮
    Button: {
      colorPrimary: "#00b96b",
      algorithm: true,
    },
    // 输入框
    Input: {
      colorBgContainer: "#ffffff",
      colorBorder: "#d9d9d9",
      hoverBorderColor: "#00b96b",
      activeBorderColor: "#00b96b",
      activeShadow: "0 0 0 2px rgba(0, 185, 107, 0.1)",
      colorTextPlaceholder: "rgba(0, 0, 0, 0.25)",
      colorBgContainerDisabled: "rgba(0, 0, 0, 0.04)",
    },
    // 下拉选择
    Select: {
      colorBgContainer: "#ffffff",
      colorBorder: "#d9d9d9",
      hoverBorderColor: "#00b96b",
      optionSelectedBg: "#e6fff4",
      optionActiveBg: "rgba(0, 0, 0, 0.04)",
    },
    // 下拉菜单 - 使用 Menu 组件的 token
    Dropdown: {
      colorBgElevated: "#ffffff",
    },
    // 菜单 - Dropdown 内部使用
    Menu: {
      colorBgContainer: "#ffffff",
      colorItemBgSelected: "rgba(0, 0, 0, 0.06)",
      colorItemTextSelected: "rgba(0, 0, 0, 0.88)",
      colorItemBgHover: "rgba(0, 0, 0, 0.04)",
      colorActiveBarWidth: 0,
      borderRadius: 6,
      itemBorderRadius: 4,
      subMenuItemBorderRadius: 4,
    },
    // 弹窗
    Modal: {
      contentBg: "#ffffff",
      headerBg: "#ffffff",
      titleColor: "rgba(0, 0, 0, 0.88)",
      colorIcon: "rgba(0, 0, 0, 0.65)",
      colorIconHover: "rgba(0, 0, 0, 0.88)",
    },
    // 卡片
    Card: {
      colorBgContainer: "#ffffff",
      colorBorderSecondary: "#f0f0f0",
    },
    // 表格
    Table: {
      colorBgContainer: "#ffffff",
      headerBg: "#f5f5f5",
      headerColor: "rgba(0, 0, 0, 0.88)",
      rowHoverBg: "rgba(0, 0, 0, 0.04)",
      borderColor: "#f0f0f0",
    },
    // 标签页
    Tabs: {
      colorBgContainer: "#ffffff",
      inkBarColor: "#00b96b",
      itemActiveColor: "#00b96b",
      itemHoverColor: "#2ed68a",
      itemSelectedColor: "#00b96b",
      cardBg: "#ffffff",
    },
    // 提示框
    Tooltip: {
      colorBgSpotlight: "rgba(0, 0, 0, 0.75)",
      colorTextLightSolid: "#ffffff",
    },
    // 消息提示
    Message: {
      contentBg: "#ffffff",
    },
    // 通知
    Notification: {
      colorBgElevated: "#ffffff",
    },
    // 开关
    Switch: {
      colorPrimary: "#00b96b",
      colorPrimaryHover: "#2ed68a",
    },
    // 复选框
    Checkbox: {
      colorPrimary: "#00b96b",
      colorPrimaryHover: "#2ed68a",
    },
    // 单选框
    Radio: {
      colorPrimary: "#00b96b",
      colorPrimaryHover: "#2ed68a",
    },
  },
};

// 深色主题配置
export const darkTheme: ThemeConfig = {
  token: {
    // 主色调
    colorPrimary: "#4dd497",
    colorLink: "#4dd497",
    colorSuccess: "#49aa19",
    colorWarning: "#d89614",
    colorError: "#dc4446",
    colorInfo: "#4dd497",

    // 背景色
    colorBgContainer: "#141414",
    colorBgElevated: "#1f1f1f",
    colorBgLayout: "#000000",
    colorBgSpotlight: "rgba(255, 255, 255, 0.85)",
    colorBgMask: "rgba(0, 0, 0, 0.65)",

    // 文字色
    colorText: "rgba(255, 255, 255, 0.88)",
    colorTextSecondary: "rgba(255, 255, 255, 0.65)",
    colorTextTertiary: "rgba(255, 255, 255, 0.45)",
    colorTextQuaternary: "rgba(255, 255, 255, 0.25)",
    colorTextDisabled: "rgba(255, 255, 255, 0.25)",

    // 边框色
    colorBorder: "#424242",
    colorBorderSecondary: "#303030",

    // 圆角
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    borderRadiusXS: 2,

    // 字体
    fontFamily: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,

    // 控件高度
    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,

    // 阴影
    boxShadow: "0 6px 16px 0 rgba(0, 0, 0, 0.3), 0 3px 6px -4px rgba(0, 0, 0, 0.4), 0 9px 28px 8px rgba(0, 0, 0, 0.3)",
    boxShadowSecondary: "0 6px 16px 0 rgba(0, 0, 0, 0.3), 0 3px 6px -4px rgba(0, 0, 0, 0.4), 0 9px 28px 8px rgba(0, 0, 0, 0.3)",
  },
  components: {
    // 按钮
    Button: {
      colorPrimary: "#4dd497",
      algorithm: true,
    },
    // 输入框
    Input: {
      colorBgContainer: "#141414",
      colorBorder: "#424242",
      hoverBorderColor: "#4dd497",
      activeBorderColor: "#4dd497",
      activeShadow: "0 0 0 2px rgba(77, 212, 151, 0.2)",
      colorTextPlaceholder: "rgba(255, 255, 255, 0.25)",
      colorBgContainerDisabled: "rgba(255, 255, 255, 0.04)",
    },
    // 下拉选择
    Select: {
      colorBgContainer: "#141414",
      colorBorder: "#424242",
      hoverBorderColor: "#4dd497",
      optionSelectedBg: "#0a2e1a",
      optionActiveBg: "rgba(255, 255, 255, 0.08)",
    },
    // 下拉菜单
    Dropdown: {
      colorBgElevated: "#1f1f1f",
    },
    // 菜单
    Menu: {
      colorBgContainer: "#1f1f1f",
      colorItemBgSelected: "rgba(255, 255, 255, 0.12)",
      colorItemTextSelected: "rgba(255, 255, 255, 0.88)",
      colorItemBgHover: "rgba(255, 255, 255, 0.08)",
      colorActiveBarWidth: 0,
      borderRadius: 6,
      itemBorderRadius: 4,
      subMenuItemBorderRadius: 4,
    },
    // 弹窗
    Modal: {
      contentBg: "#1f1f1f",
      headerBg: "#1f1f1f",
      titleColor: "rgba(255, 255, 255, 0.88)",
      colorIcon: "rgba(255, 255, 255, 0.65)",
      colorIconHover: "rgba(255, 255, 255, 0.88)",
    },
    // 卡片
    Card: {
      colorBgContainer: "#1f1f1f",
      colorBorderSecondary: "#303030",
    },
    // 表格
    Table: {
      colorBgContainer: "#141414",
      headerBg: "#000000",
      headerColor: "rgba(255, 255, 255, 0.88)",
      rowHoverBg: "rgba(255, 255, 255, 0.08)",
      borderColor: "#303030",
    },
    // 标签页
    Tabs: {
      colorBgContainer: "#141414",
      inkBarColor: "#4dd497",
      itemActiveColor: "#4dd497",
      itemHoverColor: "#7fe4b3",
      itemSelectedColor: "#4dd497",
      cardBg: "#141414",
    },
    // 提示框
    Tooltip: {
      colorBgSpotlight: "rgba(50, 50, 50, 0.85)",
      colorTextLightSolid: "rgba(255, 255, 255, 0.88)",
    },
    // 消息提示
    Message: {
      contentBg: "#1f1f1f",
    },
    // 通知
    Notification: {
      colorBgElevated: "#1f1f1f",
    },
    // 开关
    Switch: {
      colorPrimary: "#4dd497",
      colorPrimaryHover: "#7fe4b3",
    },
    // 复选框
    Checkbox: {
      colorPrimary: "#4dd497",
      colorPrimaryHover: "#7fe4b3",
    },
    // 单选框
    Radio: {
      colorPrimary: "#4dd497",
      colorPrimaryHover: "#7fe4b3",
    },
  },
};
