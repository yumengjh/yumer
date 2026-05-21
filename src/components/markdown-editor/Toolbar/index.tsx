import DesktopToolbar from "./DesktopToolbar";
import MobileToolbar from "./MobileToolbar";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export default function Toolbar() {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return isMobile ? <MobileToolbar /> : <DesktopToolbar />;
}
