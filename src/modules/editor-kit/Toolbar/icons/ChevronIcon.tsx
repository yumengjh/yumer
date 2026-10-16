import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：ToolbarArrowDown
export default function ChevronIcon({ className, style }: IconProps) {
  return <YuqueIcon name="ToolbarArrowDown" className={className} style={style} />;
}
