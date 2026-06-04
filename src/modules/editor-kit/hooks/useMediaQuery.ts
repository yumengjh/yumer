import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => undefined;

      const media = window.matchMedia(query);

      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onStoreChange);
        return () => media.removeEventListener("change", onStoreChange);
      }

      media.addListener(onStoreChange);
      return () => media.removeListener(onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
