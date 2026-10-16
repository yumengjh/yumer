import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorImage
export default function PictureIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorImage" className={className} style={style} />;
}
