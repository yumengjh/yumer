import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：BgColorFill（底部色条显示当前颜色）
export default function BgColorIcon({ className, style, color }: IconProps & { color?: string }) {
  return <YuqueIcon name="BgColorFill" className={className} style={style} color={color} />;
}
