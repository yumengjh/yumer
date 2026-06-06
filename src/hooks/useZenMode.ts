"use client";

import { useState, useEffect, useCallback } from "react";

const ZEN_MODE_STORAGE_KEY = "yuediter:zen-mode";

function readStoredZenMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ZEN_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredZenMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ZEN_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // ignore
  }
}

export function useZenMode(): {
  zenMode: boolean;
  toggleZenMode: () => void;
} {
  const [zenMode, setZenMode] = useState<boolean>(readStoredZenMode);

  const toggleZenMode = useCallback(() => {
    setZenMode((prev) => {
      const next = !prev;
      writeStoredZenMode(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        toggleZenMode();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleZenMode]);

  return { zenMode, toggleZenMode };
}
