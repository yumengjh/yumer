import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorUnderline
export default function UnderlineIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorUnderline" className={className} style={style} />;
}
