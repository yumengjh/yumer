import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  buildLocalDocSnapshot,
  compareSnapshotToContent,
  createBrowserLocalSnapshotStore,
  createDebouncedLocalSnapshotWriter,
  type LocalDocSnapshot,
  type LocalSnapshotStore,
} from "@/services/local-snapshot";
import { hashEditorDoc } from "@/services/sync/hash";
import { shouldCaptureLocalSnapshotChange } from "@/services/local-snapshot-policy";

export type LocalSnapshotStatus = "idle" | "checking" | "missing" | "saved" | "mismatch" | "saving" | "error";

export type LocalSnapshotState = {
  status: LocalSnapshotStatus;
  lastCheckedAt: number | null;
  lastSavedAt: number | null;
  storedSnapshot: LocalDocSnapshot | null;
  currentHash: string | null;
  error: string | null;
};

type UseLocalDocumentSnapshotArgs = {
  docId: string | null;
  content: TiptapDoc | null;
  enabled?: boolean;
  autoSave?: boolean;
};

const EMPTY_STATE: LocalSnapshotState = {
  status: "idle",
  lastCheckedAt: null,
  lastSavedAt: null,
  storedSnapshot: null,
  currentHash: null,
  error: null,
};

export function useLocalDocumentSnapshot({
  docId,
  content,
  enabled = true,
  autoSave = true,
}: UseLocalDocumentSnapshotArgs) {
  const store = useMemo<LocalSnapshotStore>(() => createBrowserLocalSnapshotStore(), []);
  const [state, setState] = useState<LocalSnapshotState>(EMPTY_STATE);
  const docIdRef = useRef<string | null>(null);
  const lastObservedHashRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const hasEditedRef = useRef(false);
  const suppressNextCaptureRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setSafeState = useCallback((updater: (current: LocalSnapshotState) => LocalSnapshotState) => {
    if (!mountedRef.current) return;
    setState((current) => updater(current));
  }, []);

  const persistSnapshot = useCallback(
    async (snapshot: LocalDocSnapshot) => {
      const isCurrentSnapshot = () =>
        mountedRef.current &&
        docIdRef.current === snapshot.docId &&
        lastObservedHashRef.current === snapshot.hash;

      if (isCurrentSnapshot()) {
        setSafeState((current) => ({
          ...current,
          status: "saving",
          currentHash: snapshot.hash,
          error: null,
        }));
      }

      try {
        await store.write(snapshot);
        if (!isCurrentSnapshot()) return;
        setState({
          status: "saved",
          lastCheckedAt: Date.now(),
          lastSavedAt: snapshot.savedAt,
          storedSnapshot: snapshot,
          currentHash: snapshot.hash,
          error: null,
        });
      } catch (error) {
        if (!isCurrentSnapshot()) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "\u672c\u5730\u5feb\u7167\u4fdd\u5b58\u5931\u8d25",
        }));
      }
    },
    [setSafeState, store],
  );

  const snapshotWriter = useMemo(
    () => createDebouncedLocalSnapshotWriter(persistSnapshot, 800),
    [persistSnapshot],
  );

  const scheduleSnapshotWrite = useCallback(
    (nextDocId: string, nextContent: TiptapDoc) => {
      snapshotWriter.schedule(buildLocalDocSnapshot(nextDocId, nextContent));
    },
    [snapshotWriter],
  );

  const ignoreNextContentChange = useCallback(() => {
    snapshotWriter.cancel();
    suppressNextCaptureRef.current = true;
  }, [snapshotWriter]);

  useEffect(() => {
    return () => {
      void snapshotWriter.flush();
    };
  }, [snapshotWriter]);

  useEffect(() => {
    if (!enabled || !docId || !content) {
      void snapshotWriter.flush();
      docIdRef.current = null;
      lastObservedHashRef.current = null;
      hasEditedRef.current = false;
      setState(EMPTY_STATE);
      return;
    }

    const currentHash = hashEditorDoc(content);
    const isNewDoc = docIdRef.current !== docId;
    if (isNewDoc && docIdRef.current) {
      void snapshotWriter.flush();
    }
    docIdRef.current = docId;

    if (isNewDoc) {
      // \u65b0\u6587\u6863\u52a0\u8f7d\uff1a\u4ec5\u8bfb\u53d6\u5feb\u7167\u505a\u5bf9\u6bd4\uff0c\u4e0d\u81ea\u52a8\u5199\u5165
      hasEditedRef.current = false;
      lastObservedHashRef.current = currentHash;
      setState((current) => ({
        ...current,
        status: "checking",
        currentHash,
        error: null,
      }));

      let cancelled = false;
      (async () => {
        try {
          const snapshot = await store.read(docId);
          if (cancelled || docIdRef.current !== docId) return;

          const checkedAt = Date.now();
          if (!snapshot) {
            setState({
              status: "missing",
              lastCheckedAt: checkedAt,
              lastSavedAt: null,
              storedSnapshot: null,
              currentHash,
              error: null,
            });
            return;
          }

          const compare = compareSnapshotToContent(snapshot, content);
          lastObservedHashRef.current = compare.currentHash;
          setState({
            status: compare.matches ? "saved" : "mismatch",
            lastCheckedAt: checkedAt,
            lastSavedAt: snapshot.savedAt,
            storedSnapshot: snapshot,
            currentHash: compare.currentHash,
            error: null,
          });
        } catch (error) {
          if (cancelled || docIdRef.current !== docId) return;
          setState({
            status: "error",
            lastCheckedAt: Date.now(),
            lastSavedAt: null,
            storedSnapshot: null,
            currentHash,
            error: error instanceof Error ? error.message : "\u8bfb\u53d6\u672c\u5730\u5feb\u7167\u5931\u8d25",
          });
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    // \u5185\u5bb9\u54c8\u5e0c\u672a\u53d8\u5316\uff0c\u8df3\u8fc7
    if (lastObservedHashRef.current === currentHash) {
      return;
    }

    const suppressCapture = suppressNextCaptureRef.current;
    suppressNextCaptureRef.current = false;

    if (suppressCapture) {
      lastObservedHashRef.current = currentHash;
      hasEditedRef.current = false;
      setState((current) => {
        if (!current.storedSnapshot) {
          return {
            ...current,
            status: "missing",
            currentHash,
            error: null,
          };
        }

        const compare = compareSnapshotToContent(current.storedSnapshot, content);
        return {
          ...current,
          status: compare.matches ? "saved" : "mismatch",
          currentHash: compare.currentHash,
          error: null,
        };
      });
      return;
    }

    // \u54c8\u5e0c\u53d8\u5316\uff1a\u6807\u8bb0\u4e3a\u5df2\u7f16\u8f91\uff0c\u540e\u7eed\u53d8\u5316\u624d\u81ea\u52a8\u4fdd\u5b58
    const wasEdited = hasEditedRef.current;
    lastObservedHashRef.current = currentHash;
    hasEditedRef.current = true;

    if (shouldCaptureLocalSnapshotChange({ autoSave, wasEdited, suppressCapture: false })) {
      scheduleSnapshotWrite(docId, content);
    }
  }, [content, docId, enabled, autoSave, scheduleSnapshotWrite, snapshotWriter, store]);

  const refreshSnapshot = useCallback(async () => {
    if (!docId || !content) return;
    await snapshotWriter.flush();
    const snapshot = await store.read(docId);
    const currentHash = hashEditorDoc(content);
    const checkedAt = Date.now();

    if (!snapshot) {
      setState({
        status: "missing",
        lastCheckedAt: checkedAt,
        lastSavedAt: null,
        storedSnapshot: null,
        currentHash,
        error: null,
      });
      return;
    }

    const compare = compareSnapshotToContent(snapshot, content);
    const nextState: LocalSnapshotState = {
      status: compare.matches ? "saved" : "mismatch",
      lastCheckedAt: checkedAt,
      lastSavedAt: snapshot.savedAt,
      storedSnapshot: snapshot,
      currentHash: compare.currentHash,
      error: null,
    };
    lastObservedHashRef.current = compare.currentHash;
    setState(nextState);
    return;
  }, [content, docId, snapshotWriter, store]);

  const clearSnapshot = useCallback(async () => {
    if (!docId) return;
    snapshotWriter.cancel();
    await store.remove(docId);
    lastObservedHashRef.current = null;
    setState(EMPTY_STATE);
  }, [docId, snapshotWriter, store]);

  const manualSave = useCallback(async () => {
    if (!docId || !content) return;
    const snapshot = buildLocalDocSnapshot(docId, content);
    await persistSnapshot(snapshot);
  }, [content, docId, persistSnapshot]);

  const copyStoredSnapshot = useCallback(async () => {
    await snapshotWriter.flush();
    const snapshot = docId ? await store.read(docId) : state.storedSnapshot;
    if (!snapshot) return false;
    await navigator.clipboard.writeText(JSON.stringify(snapshot.content, null, 2));
    return true;
  }, [docId, snapshotWriter, state.storedSnapshot, store]);

  const copyCurrentSnapshot = useCallback(async () => {
    if (!content) return false;
    await navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    return true;
  }, [content]);

  return {
    state,
    refreshSnapshot,
    clearSnapshot,
    copyStoredSnapshot,
    copyCurrentSnapshot,
    manualSave,
    ignoreNextContentChange,
  };
}
