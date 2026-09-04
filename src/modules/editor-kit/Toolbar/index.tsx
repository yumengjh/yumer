import DesktopToolbar from "./DesktopToolbar";
import MobileToolbar from "./MobileToolbar";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface ToolbarProps {
  enabledItemIds?: ReadonlySet<string>;
  onAiChatToggle?: () => void;
}

export default function Toolbar({ enabledItemIds, onAiChatToggle }: ToolbarProps = {}) {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return isMobile ? (
    <MobileToolbar enabledItemIds={enabledItemIds} onAiChatToggle={onAiChatToggle} />
  ) : (
    <DesktopToolbar enabledItemIds={enabledItemIds} onAiChatToggle={onAiChatToggle} />
  );
}
