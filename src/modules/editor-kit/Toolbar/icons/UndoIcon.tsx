import type { IconProps } from "./IconProps";
import YuqueIcon from "./YuqueIcon";

// 语雀原版图标：EditorUndo
export default function UndoIcon({ className, style }: IconProps) {
  return <YuqueIcon name="EditorUndo" className={className} style={style} />;
}
