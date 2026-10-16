import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorCodeblock
export default function CodeIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorCodeblock" className={className} style={style} />;
}
