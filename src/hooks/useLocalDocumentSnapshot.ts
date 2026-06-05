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

export type LocalSnapshotStatus =
  | "idle"
  | "checking"
  | "missing"
  | "matched"
  | "saved"
  | "mismatch"
  | "saving"
  | "error";

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
  hasUnsavedChanges?: boolean;
};

const EMPTY_STATE: LocalSnapshotState = {
  status: "idle",
  lastCheckedAt: null,
  lastSavedAt: null,
  storedSnapshot: null,
  currentHash: null,
  error: null,
};

function snapshotWriteKey(snapshot: LocalDocSnapshot): string {
  return `${snapshot.docId}:${snapshot.savedAt}:${snapshot.hash}`;
}

export function useLocalDocumentSnapshot({
  docId,
  content,
  enabled = true,
  autoSave = true,
  hasUnsavedChanges = false,
}: UseLocalDocumentSnapshotArgs) {
  const store = useMemo<LocalSnapshotStore>(() => createBrowserLocalSnapshotStore(), []);
  const [state, setState] = useState<LocalSnapshotState>(EMPTY_STATE);
  const docIdRef = useRef<string | null>(null);
  const lastObservedHashRef = useRef<string | null>(null);
  const lastObservedContentRef = useRef<TiptapDoc | null>(null);
  const latestSnapshotWriteKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
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
        latestSnapshotWriteKeyRef.current === snapshotWriteKey(snapshot);

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
      snapshotWriter.schedule(() => {
        const snapshot = buildLocalDocSnapshot(nextDocId, nextContent);
        latestSnapshotWriteKeyRef.current = snapshotWriteKey(snapshot);
        lastObservedHashRef.current = snapshot.hash;
        return snapshot;
      });
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
      snapshotWriter.cancel();
      docIdRef.current = null;
      lastObservedHashRef.current = null;
      lastObservedContentRef.current = null;
      latestSnapshotWriteKeyRef.current = null;
      setState(EMPTY_STATE);
      return;
    }

    const isNewDoc = docIdRef.current !== docId;
    if (isNewDoc && docIdRef.current) {
      snapshotWriter.cancel();
      latestSnapshotWriteKeyRef.current = null;
    }
    docIdRef.current = docId;

    if (isNewDoc) {
      const currentHash = hashEditorDoc(content);
      // New document load: read existing snapshot metadata only; do not write or compare.
      lastObservedHashRef.current = currentHash;
      lastObservedContentRef.current = content;
      setState((current) => ({
        ...current,
        status: "idle",
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

          setState({
            status: "idle",
            lastCheckedAt: checkedAt,
            lastSavedAt: snapshot.savedAt,
            storedSnapshot: snapshot,
            currentHash,
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

    if (lastObservedContentRef.current === content) {
      return;
    }
    lastObservedContentRef.current = content;

    const suppressCapture = suppressNextCaptureRef.current;
    suppressNextCaptureRef.current = false;

    if (suppressCapture) {
      const currentHash = hashEditorDoc(content);
      lastObservedHashRef.current = currentHash;
      setState((current) => ({
        ...current,
        currentHash,
        error: null,
      }));
      return;
    }

    // \u52a0\u8f7d/\u5237\u65b0\u540e\u4ec5 compare 不写\u5165\uff1b\u8fdb\u5165\u8fd9\u4e2a\u5206\u652f\u8bf4\u660e\u5df2\u7ecf\u662f\u771f\u5b9e\u7528\u6237\u7f16\u8f91\uff0c\u7b2c\u4e00\u7b14\u4e5f\u8981\u81ea\u52a8\u6355\u83b7
    if (shouldCaptureLocalSnapshotChange({ autoSave, hasUnsavedChanges, suppressCapture: false })) {
      setSafeState((current) =>
        current.status === "saving" && current.error === null
          ? current
          : {
              ...current,
              status: "saving",
              error: null,
            },
      );
      scheduleSnapshotWrite(docId, content);
      return;
    }

    setSafeState((current) => {
      const nextStatus = current.status === "saving" ? "saving" : "idle";
      if (current.status === nextStatus && current.error === null) return current;
      return {
        ...current,
        status: nextStatus,
        error: null,
      };
    });
  }, [content, docId, enabled, autoSave, hasUnsavedChanges, scheduleSnapshotWrite, setSafeState, snapshotWriter, store]);

  const refreshSnapshot = useCallback(async () => {
    if (!docId || !content) return;
    const currentHash = hashEditorDoc(content);
    setState((current) => ({
      ...current,
      status: "checking",
      currentHash,
      error: null,
    }));
    const snapshot = await store.read(docId);
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
      status: compare.matches ? "matched" : "mismatch",
      lastCheckedAt: checkedAt,
      lastSavedAt: snapshot.savedAt,
      storedSnapshot: snapshot,
      currentHash: compare.currentHash,
      error: null,
    };
    lastObservedHashRef.current = compare.currentHash;
    setState(nextState);
    return;
  }, [content, docId, store]);

  const clearSnapshot = useCallback(async () => {
    if (!docId) return;
    snapshotWriter.cancel();
    await store.remove(docId);
    lastObservedHashRef.current = null;
    latestSnapshotWriteKeyRef.current = null;
    setState(EMPTY_STATE);
  }, [docId, snapshotWriter, store]);

  const manualSave = useCallback(async () => {
    if (!docId || !content) return;
    const snapshot = buildLocalDocSnapshot(docId, content);
    lastObservedHashRef.current = snapshot.hash;
    latestSnapshotWriteKeyRef.current = snapshotWriteKey(snapshot);
    await persistSnapshot(snapshot);
  }, [content, docId, persistSnapshot]);

  const copyStoredSnapshot = useCallback(async () => {
    const snapshot = docId ? await store.read(docId) : state.storedSnapshot;
    if (!snapshot) return false;
    await navigator.clipboard.writeText(JSON.stringify(snapshot.content, null, 2));
    return true;
  }, [docId, state.storedSnapshot, store]);

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
