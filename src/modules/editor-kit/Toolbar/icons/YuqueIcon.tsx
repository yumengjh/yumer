import type { CSSProperties } from "react";
import { YUQUE_ICONS, type YuqueIconName } from "./yuqueIconData";

interface YuqueIconProps {
  name: YuqueIconName;
  className?: string;
  style?: CSSProperties;
  /** 颜色类图标（FontColor / BgColorFill）底部色条的颜色 */
  color?: string;
}

/** 渲染语雀原版 SVG 图标，尺寸跟随 font-size（1em）。 */
export default function YuqueIcon({ name, className, style, color }: YuqueIconProps) {
  const [viewBox, body] = YUQUE_ICONS[name];
  const html = body.includes("__COLOR__")
    ? body.replaceAll("__COLOR__", color || "currentColor")
    : body;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox={viewBox}
      fill="currentColor"
      className={["yq-icon", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export type { YuqueIconName };
