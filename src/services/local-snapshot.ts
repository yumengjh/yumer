import type { TiptapDoc } from "@/services/tiptap-converter";
import { hashEditorDoc } from "@/services/sync/hash";
import { DEFAULT_FILTER_KEYS, deepFilterKeys } from "@/services/local-snapshot-filter";

export type LocalDocSnapshot = {
  docId: string;
  savedAt: number;
  hash: string;
  content: TiptapDoc;
};

export type LocalSnapshotCompareResult = {
  matches: boolean;
  currentHash: string;
  snapshotHash: string;
};

export type LocalSnapshotRestoreDecisionInput = {
  snapshot: LocalDocSnapshot | null;
  recoveryMarker: LocalSnapshotRecoveryMarker | null;
  serverContent: TiptapDoc;
  serverUpdatedAt?: string | number | Date | null;
  maxAgeMs?: number;
  now?: number;
};

export type LocalSnapshotRecoveryReason = "dirty" | "flushing" | "error";

export type LocalSnapshotRecoveryMarker = {
  docId: string;
  savedAt: number;
  hash: string;
  markedAt: number;
  reason: LocalSnapshotRecoveryReason;
};

export interface LocalSnapshotStore {
  read(docId: string): Promise<LocalDocSnapshot | null>;
  write(snapshot: LocalDocSnapshot): Promise<void>;
  remove(docId: string): Promise<void>;
}

export interface DebouncedLocalSnapshotWriter {
  schedule(snapshot: LocalDocSnapshot): void;
  flush(): Promise<void>;
  cancel(): void;
}

const SNAPSHOT_HASH_FILTER_KEYS = new Set(DEFAULT_FILTER_KEYS);

function hashSnapshotComparableDoc(content: TiptapDoc): string {
  return hashEditorDoc(deepFilterKeys(content, SNAPSHOT_HASH_FILTER_KEYS) as TiptapDoc);
}

function cloneSnapshot(snapshot: LocalDocSnapshot): LocalDocSnapshot {
  return {
    ...snapshot,
    content: structuredClone(snapshot.content),
  };
}

function storageKey(docId: string): string {
  return `yuediter:local-snapshot:${docId}`;
}

function recoveryMarkerKey(docId: string): string {
  return `yuediter:local-snapshot-recovery:${docId}`;
}

function parseTimestamp(value: string | number | Date | null | undefined): number {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }
  return 0;
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

async function readFromLocalStorage(docId: string): Promise<LocalDocSnapshot | null> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey(docId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LocalDocSnapshot;
    if (!parsed || parsed.docId !== docId || typeof parsed.hash !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeToLocalStorageSync(snapshot: LocalDocSnapshot): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(storageKey(snapshot.docId), JSON.stringify(snapshot));
}

async function writeToLocalStorage(snapshot: LocalDocSnapshot): Promise<void> {
  writeToLocalStorageSync(snapshot);
}

async function removeFromLocalStorage(docId: string): Promise<void> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.removeItem(storageKey(docId));
}

function openSnapshotDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("yuediter-local-snapshot", 1);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地快照数据库"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "docId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    // 防止 IndexedDB 连接挂起
    setTimeout(() => reject(new Error("IndexedDB 连接超时")), 3000);
  });
}

async function readFromIndexedDB(docId: string): Promise<LocalDocSnapshot | null> {
  const db = await openSnapshotDb();
  try {
    return await new Promise<LocalDocSnapshot | null>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly");
      const store = tx.objectStore("snapshots");
      const request = store.get(docId);
      request.onerror = () => reject(request.error ?? new Error("读取本地快照失败"));
      request.onsuccess = () => resolve((request.result as LocalDocSnapshot | undefined) ?? null);
      // 防止 IndexedDB 操作挂起导致状态卡死
      setTimeout(() => reject(new Error("IndexedDB 读取超时")), 3000);
    });
  } finally {
    db.close();
  }
}

async function writeToIndexedDB(snapshot: LocalDocSnapshot): Promise<void> {
  const db = await openSnapshotDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const store = tx.objectStore("snapshots");
      store.put(snapshot);
      tx.onerror = () => reject(tx.error ?? new Error("写入本地快照失败"));
      tx.oncomplete = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function removeFromIndexedDB(docId: string): Promise<void> {
  const db = await openSnapshotDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const store = tx.objectStore("snapshots");
      store.delete(docId);
      tx.onerror = () => reject(tx.error ?? new Error("删除本地快照失败"));
      tx.oncomplete = () => resolve();
    });
  } finally {
    db.close();
  }
}

export function buildLocalDocSnapshot(
  docId: string,
  content: TiptapDoc,
  savedAt = Date.now(),
): LocalDocSnapshot {
  return {
    docId,
    savedAt,
    hash: hashSnapshotComparableDoc(content),
    content: structuredClone(content),
  };
}

export function compareSnapshotToContent(
  snapshot: LocalDocSnapshot,
  content: TiptapDoc,
): LocalSnapshotCompareResult {
  const currentHash = hashSnapshotComparableDoc(content);
  return {
    matches: snapshot.hash === currentHash,
    currentHash,
    snapshotHash: snapshot.hash,
  };
}

export function readLocalSnapshotRecoveryMarker(
  docId: string,
): LocalSnapshotRecoveryMarker | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  const raw = window.localStorage.getItem(recoveryMarkerKey(docId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LocalSnapshotRecoveryMarker;
    if (!parsed || parsed.docId !== docId) return null;
    if (typeof parsed.savedAt !== "number" || typeof parsed.hash !== "string") return null;
    if (typeof parsed.markedAt !== "number") return null;
    if (!["dirty", "flushing", "error"].includes(parsed.reason)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalSnapshotRecoveryBackup(
  snapshot: LocalDocSnapshot,
  reason: LocalSnapshotRecoveryReason,
): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  writeToLocalStorageSync(snapshot);
  const marker: LocalSnapshotRecoveryMarker = {
    docId: snapshot.docId,
    savedAt: snapshot.savedAt,
    hash: snapshot.hash,
    markedAt: Date.now(),
    reason,
  };
  window.localStorage.setItem(recoveryMarkerKey(snapshot.docId), JSON.stringify(marker));
}

export function clearLocalSnapshotRecoveryMarker(docId: string): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.removeItem(recoveryMarkerKey(docId));
}

export function shouldRestoreLocalSnapshotAfterLoad({
  snapshot,
  recoveryMarker,
  serverContent,
  serverUpdatedAt,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
  now = Date.now(),
}: LocalSnapshotRestoreDecisionInput): boolean {
  if (!snapshot) return false;
  if (!recoveryMarker) return false;
  if (recoveryMarker.docId !== snapshot.docId) return false;
  if (recoveryMarker.hash !== snapshot.hash) return false;
  if (recoveryMarker.savedAt !== snapshot.savedAt) return false;
  if (now - snapshot.savedAt > maxAgeMs) return false;
  if (now - recoveryMarker.markedAt > maxAgeMs) return false;
  if (compareSnapshotToContent(snapshot, serverContent).matches) return false;

  const serverTime = parseTimestamp(serverUpdatedAt);
  return serverTime === 0 || serverTime - snapshot.savedAt <= maxAgeMs;
}

export function createDebouncedLocalSnapshotWriter(
  writeSnapshot: (snapshot: LocalDocSnapshot) => Promise<void>,
  delayMs = 800,
): DebouncedLocalSnapshotWriter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: LocalDocSnapshot | null = null;
  let writeChain = Promise.resolve();

  const enqueueWrite = (snapshot: LocalDocSnapshot) => {
    writeChain = writeChain
      .catch(() => {})
      .then(() => writeSnapshot(cloneSnapshot(snapshot)));
    return writeChain;
  };

  const flushPending = () => {
    if (!pendingSnapshot) return;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    void enqueueWrite(snapshot);
  };

  return {
    schedule(snapshot: LocalDocSnapshot) {
      pendingSnapshot = cloneSnapshot(snapshot);
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        flushPending();
      }, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flushPending();
      await writeChain;
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingSnapshot = null;
    },
  };
}

export function createMemoryLocalSnapshotStore(initial?: Record<string, LocalDocSnapshot>): LocalSnapshotStore {
  const memoryStore = new Map<string, LocalDocSnapshot>();
  if (initial) {
    for (const [docId, snapshot] of Object.entries(initial)) {
      memoryStore.set(docId, cloneSnapshot(snapshot));
    }
  }

  return {
    async read(docId: string) {
      return memoryStore.has(docId) ? cloneSnapshot(memoryStore.get(docId)!) : null;
    },
    async write(snapshot: LocalDocSnapshot) {
      memoryStore.set(snapshot.docId, cloneSnapshot(snapshot));
    },
    async remove(docId: string) {
      memoryStore.delete(docId);
    },
  };
}

export function createBrowserLocalSnapshotStore(): LocalSnapshotStore {
  const useIndexedDb = hasIndexedDB();

  return {
    async read(docId: string) {
      const localSnapshot = await readFromLocalStorage(docId);
      if (useIndexedDb) {
        try {
          const indexedSnapshot = await readFromIndexedDB(docId);
          if (!indexedSnapshot) return localSnapshot;
          if (!localSnapshot) return indexedSnapshot;
          return localSnapshot.savedAt > indexedSnapshot.savedAt
            ? localSnapshot
            : indexedSnapshot;
        } catch {
          return localSnapshot;
        }
      }
      return localSnapshot;
    },
    async write(snapshot: LocalDocSnapshot) {
      await writeToLocalStorage(snapshot);
      if (useIndexedDb) {
        try {
          await writeToIndexedDB(snapshot);
          return;
        } catch {
          return;
        }
      }
    },
    async remove(docId: string) {
      await removeFromLocalStorage(docId);
      clearLocalSnapshotRecoveryMarker(docId);
      if (useIndexedDb) {
        try {
          await removeFromIndexedDB(docId);
          return;
        } catch {
          return;
        }
      }
    },
  };
}
