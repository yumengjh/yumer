import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：FontColor（底部色条显示当前颜色）
export default function TextColorIcon({ className, style, color }: IconProps & { color?: string }) {
  return <YuqueIcon name="FontColor" className={className} style={style} color={color} />;
}
