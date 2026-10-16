import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorQuote
export default function QuoteIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorQuote" className={className} style={style} />;
}
