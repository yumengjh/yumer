import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorTaskList
export default function CheckListIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorTaskList" className={className} style={style} />;
}
