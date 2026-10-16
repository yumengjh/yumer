import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorStrikethrough
export default function StrikethroughIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorStrikethrough" className={className} style={style} />;
}
