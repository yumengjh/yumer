import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorItalic
export default function ItalicIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorItalic" className={className} style={style} />;
}
