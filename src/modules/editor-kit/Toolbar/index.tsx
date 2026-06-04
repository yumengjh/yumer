import DesktopToolbar from "./DesktopToolbar";
import MobileToolbar from "./MobileToolbar";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface ToolbarProps {
  enabledItemIds?: ReadonlySet<string>;
}

export default function Toolbar({ enabledItemIds }: ToolbarProps = {}) {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return isMobile ? <MobileToolbar /> : <DesktopToolbar enabledItemIds={enabledItemIds} />;
}
