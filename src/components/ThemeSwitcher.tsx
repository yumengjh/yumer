"use client";

import { useTheme, type ThemeMode } from "@/theme/ThemeContext";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const options: { value: ThemeMode; label: string; icon: string }[] = [
    { value: "light", label: "浅色", icon: "☀️" },
    { value: "dark", label: "深色", icon: "🌙" },
    { value: "system", label: "系统", icon: "💻" },
  ];

  return (
    <div className="theme-switcher">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`theme-switcher__btn ${theme === opt.value ? "is-active" : ""}`}
          onClick={() => setTheme(opt.value)}
          title={opt.label}
        >
          <span className="theme-switcher__icon">{opt.icon}</span>
        </button>
      ))}
    </div>
  );
}
