import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorLink
export default function LinkIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorLink" className={className} style={style} />;
}
