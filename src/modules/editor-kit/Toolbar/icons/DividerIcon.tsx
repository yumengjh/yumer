import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorHr
export default function DividerIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorHr" className={className} style={style} />;
}
