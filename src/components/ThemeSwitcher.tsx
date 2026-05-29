"use client";

import { Dropdown, Tooltip } from "antd";
import { useTheme, type ThemeMode } from "@/theme";

const themeOptions = [
  { key: "light", label: "浅色模式", icon: "☀️" },
  { key: "dark", label: "深色模式", icon: "🌙" },
  { key: "system", label: "跟随系统", icon: "💻" },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const currentOption = themeOptions.find((opt) => opt.key === theme) || themeOptions[2];

  return (
    <Tooltip title="切换主题">
      <Dropdown
        menu={{
          items: themeOptions.map((opt) => ({
            key: opt.key,
            label: (
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
                {theme === opt.key && <span style={{ marginLeft: "auto" }}>✓</span>}
              </span>
            ),
          })),
          onClick: ({ key }) => setTheme(key as ThemeMode),
          selectedKeys: [theme],
        }}
        trigger={["click"]}
      >
        <button
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            boxShadow: "var(--shadow-md)",
            transition: "all var(--transition-normal)",
            zIndex: 1000,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.1)";
            e.currentTarget.style.boxShadow = "var(--shadow-lg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = "var(--shadow-md)";
          }}
        >
          {currentOption.icon}
        </button>
      </Dropdown>
    </Tooltip>
  );
}
