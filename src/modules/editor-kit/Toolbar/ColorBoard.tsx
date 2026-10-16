import { useState } from "react";
import { ColorPicker } from "antd";
import YuqueIcon from "./icons/YuqueIcon";

// 语雀 Lake 调色板（与语雀编辑器字体颜色 / 背景颜色面板一致，含中文名）
export const YUQUE_COLOR_ROWS: Array<Array<[string, string]>> = [
  [["黑色", "#000000"], ["深灰 3", "#262626"], ["深灰 2", "#585A5A"], ["深灰 1", "#8A8F8D"], ["灰色", "#D8DAD9"], ["浅灰 4", "#E7E9E8"], ["浅灰 3", "#EFF0F0"], ["浅灰 2", "#F4F5F5"], ["浅灰 1", "#FAFAFA"], ["白色", "#FFFFFF"]],
  [["红色", "#DF2A3F"], ["橘橙", "#ED740C"], ["金盏黄", "#ECAA04"], ["柠檬黄", "#FBDE28"], ["绿色", "#74B602"], ["青色", "#1DC0C9"], ["浅蓝", "#117CEE"], ["蓝色", "#2F4BDA"], ["紫色", "#601BDE"], ["玫红", "#D22D8D"]],
  [["红色 1", "#FBE4E7"], ["橘橙 1", "#FDE6D3"], ["金盏黄 1", "#F9EFCD"], ["柠檬黄 1", "#FBF5CB"], ["绿色 1", "#E8F7CF"], ["青色 1", "#CEF5F7"], ["浅蓝 1", "#D9EAFC"], ["蓝色 1", "#D9DFFC"], ["紫色 1", "#E6DCF9"], ["玫红 1", "#FBDFEF"]],
  [["红色 2", "#F1A2AB"], ["橘橙 2", "#F8B881"], ["金盏黄 2", "#F5D480"], ["柠檬黄 2", "#FCE75A"], ["绿色 2", "#C1E77E"], ["青色 2", "#81DFE4"], ["浅蓝 2", "#81BBF8"], ["蓝色 2", "#96A7FD"], ["紫色 2", "#BA9BF2"], ["玫红 2", "#F297CC"]],
  [["红色 3", "#E4495B"], ["橘橙 3", "#F38F39"], ["金盏黄 3", "#F3BB2F"], ["柠檬黄 3", "#EDCE02"], ["绿色 3", "#8CCF17"], ["青色 3", "#01B2BC"], ["浅蓝 3", "#2F8EF4"], ["蓝色 3", "#4861E0"], ["紫色 3", "#7E45E8"], ["玫红 3", "#E746A4"]],
  [["红色 4", "#AD1A2B"], ["橘橙 4", "#C75C00"], ["金盏黄 4", "#C99103"], ["柠檬黄 4", "#A58F04"], ["绿色 4", "#5C8D07"], ["青色 4", "#07787E"], ["浅蓝 4", "#0C68CA"], ["蓝色 4", "#213BC0"], ["紫色 4", "#4C16B1"], ["玫红 4", "#AE146E"]],
  [["红色 5", "#70000D"], ["橘橙 5", "#663000"], ["金盏黄 5", "#664900"], ["柠檬黄 5", "#665800"], ["绿色 5", "#2A4200"], ["青色 5", "#004347"], ["浅蓝 5", "#00346B"], ["蓝色 5", "#101E60"], ["紫色 5", "#270070"], ["玫红 5", "#5C0036"]],
];

/** 字体颜色默认值（语雀「默认」= 深灰 3） */
export const YUQUE_DEFAULT_TEXT_COLOR = "#262626";

const RECENT_KEY = "yuediter:color-board-recent";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(colors: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(colors.slice(0, MAX_RECENT)));
  } catch {
    // 本地存储不可用时只影响「最近使用」
  }
}

/** 浅色色块上的对勾需要用深色才看得见 */
function isLightColor(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 200;
}

const CHECK_PATH = "M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z";

function Swatch({ title, color, active, onPick }: { title: string; color: string; active: boolean; onPick: (color: string) => void }) {
  const bordered = isLightColor(color);
  return (
    <span
      className={`yq-colorboard__item${bordered ? " yq-colorboard__item--border" : ""}${active ? " is-active" : ""}`}
      title={title}
      onClick={() => onPick(color)}
    >
      <span style={{ backgroundColor: color }}>
        {active && (
          <svg viewBox="0 0 18 18" style={{ fill: bordered ? "#262626" : "#fff" }}>
            <path d={CHECK_PATH} />
          </svg>
        )}
      </span>
    </span>
  );
}

interface ColorBoardProps {
  /** text：字体颜色（默认 = 深灰 3）；background：背景颜色（默认 = 无填充色） */
  kind: "text" | "background";
  value: string | null;
  onChange: (color: string | null) => void;
}

/** 语雀风格调色板：默认 / 10×7 色块 / 最近使用自定义颜色 / 更多颜色 */
export default function ColorBoard({ kind, value, onChange }: ColorBoardProps) {
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : loadRecent()));
  const current = value?.toUpperCase() ?? null;
  const isDefault = kind === "text" ? !current || current === YUQUE_DEFAULT_TEXT_COLOR : !current;

  const pickCustom = (color: string) => {
    const next = [color, ...recent.filter((item) => item.toUpperCase() !== color.toUpperCase())].slice(0, MAX_RECENT);
    setRecent(next);
    saveRecent(next);
    onChange(color);
  };

  return (
    <div className="yq-colorboard" onMouseDown={(event) => event.preventDefault()}>
      <div className="yq-colorboard__default" onClick={() => onChange(null)}>
        {kind === "text" ? (
          <Swatch title="深灰 3" color={YUQUE_DEFAULT_TEXT_COLOR} active={isDefault} onPick={() => onChange(null)} />
        ) : (
          <span className={`yq-colorboard__item yq-colorboard__item--border yq-colorboard__item--none${isDefault ? " is-active" : ""}`}>
            <span />
          </span>
        )}
        <span className="yq-colorboard__default-label">{kind === "text" ? "默认" : "无填充色"}</span>
      </div>
      {YUQUE_COLOR_ROWS.map((row, index) => (
        <div key={index} className="yq-colorboard__group">
          {row.map(([title, color]) => (
            <Swatch key={color} title={title} color={color} active={current === color} onPick={onChange} />
          ))}
        </div>
      ))}
      <div className="yq-colorboard__caption">最近使用自定义颜色</div>
      {recent.length > 0 ? (
        <div className="yq-colorboard__group">
          {recent.map((color) => (
            <Swatch key={color} title={color} color={color} active={current === color.toUpperCase()} onPick={onChange} />
          ))}
        </div>
      ) : (
        <div className="yq-colorboard__none">暂无</div>
      )}
      <div className="yq-colorboard__more">
        <ColorPicker
          value={current ?? (kind === "text" ? YUQUE_DEFAULT_TEXT_COLOR : "#FBDE28")}
          placement="rightBottom"
          disabledAlpha
          onChangeComplete={(color) => pickCustom(color.toHexString().toUpperCase())}
        >
          <div className="yq-colorboard__more-trigger">
            <span className="yq-colorboard__more-preview" />
            <span>更多颜色</span>
            <YuqueIcon name="menu-card-right-arrow" className="yq-colorboard__more-arrow" />
          </div>
        </ColorPicker>
      </div>
    </div>
  );
}
