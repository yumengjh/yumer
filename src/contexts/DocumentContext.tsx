import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import type { Route } from "next";
import {
  createDocument as apiCreateDoc,
  listDocuments as apiListDocs,
  loadDocumentContentV2,
  getDocument,
  updateDocument as apiUpdateDoc,
  deleteDocument as apiDeleteDoc,
  publishDocument as apiPublishDoc,
  publishDocumentVersion as apiPublishDocVersion,
  unpublishDocument as apiUnpublishDoc,
  type EditDraftMeta,
  type Document,
  type EditorContent,
  type LastEditPosition,
  type PublishDocumentResult,
  type SyncSessionMeta,
} from "../services/document";
import { encodeDocId } from "../lib/doc-slug";

export const DASH_PATH = "/dash";
export const DASH_EDIT_PATH = `${DASH_PATH}/edit`;
const WORKSPACE_KEY = "currentWorkspaceId";

export type SaveStatus = "idle" | "loaded" | "dirty" | "flushing" | "draft-synced" | "saved" | "no-draft" | "error";

export function getEditorPath(docId?: string | null): Route {
  return (docId ? `${DASH_EDIT_PATH}/${encodeDocId(docId)}` : DASH_PATH) as Route;
}

interface DocumentContextValue {
  workspaceId: string | null;
  currentDoc: Document | null;
  currentDocSlug: string | null;
  documents: Document[];
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  hasUnsavedChanges: boolean;
  currentDocVersion: number | null;
  currentContentSource: "draft" | "head" | null;
  currentDraftMeta: EditDraftMeta | null;
  currentSyncSession: SyncSessionMeta | null;
  currentBlockIds: string[];
  lastEditPosition: LastEditPosition | null;
  pendingScrollBlockId: string | null;
  setWorkspace: (id: string) => void;
  clearWorkspace: () => void;
  selectDoc: (docId: string) => Promise<void>;
  selectDocAndScroll: (docId: string, blockId: string) => Promise<void>;
  loadContent: (
    docId: string,
  ) => Promise<{
    content: EditorContent;
    docVer: number;
    syncSession: SyncSessionMeta | null;
  }>;
  applyCommittedVersion: (version: number, draftRevision?: number | null) => void;
  markSavedAt: (at: Date | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setHasUnsavedChanges: (value: boolean) => void;
  setPendingScrollBlockId: (blockId: string | null) => void;
  createDoc: (data: { title: string; icon?: string; cover?: string; visibility?: string; category?: string }) => Promise<Document>;
  updateDoc: (docId: string, data: { title?: string; icon?: string; cover?: string; visibility?: string; tags?: string[]; category?: string; status?: string }) => Promise<void>;
  deleteDoc: (docId: string) => Promise<void>;
  publishDoc: (docId: string) => Promise<PublishDocumentResult>;
  publishDocVersion: (docId: string, version: number) => Promise<PublishDocumentResult>;
  unpublishDoc: (docId: string) => Promise<PublishDocumentResult>;
  syncDocumentMetadata: (doc: Document) => void;
  refreshDocs: () => Promise<void>;
  getBlockId: (domIndex: number) => string | undefined;
}

const DocumentContext = createContext<DocumentContextValue | null>(null);

function belongsToWorkspace(doc: Document, workspaceId: string | null) {
  return !workspaceId || doc.workspaceId === workspaceId;
}

function resetWindowPath(docId?: string | null) {
  if (typeof window === "undefined") return;
  const path = getEditorPath(docId);
  if (window.location.pathname === path) return;
  window.history.replaceState(null, "", path);
}

function pushWindowPath(docId?: string | null) {
  if (typeof window === "undefined") return;
  const path = getEditorPath(docId);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
}

export function DocumentProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(WORKSPACE_KEY),
  );
  const [currentDoc, setCurrentDoc] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentDocVersion, setCurrentDocVersion] = useState<number | null>(null);
  const [currentContentSource, setCurrentContentSource] = useState<"draft" | "head" | null>(null);
  const [currentDraftMeta, setCurrentDraftMeta] = useState<EditDraftMeta | null>(null);
  const [currentSyncSession, setCurrentSyncSession] = useState<SyncSessionMeta | null>(null);
  const [currentBlockIds, setCurrentBlockIds] = useState<string[]>([]);
  const [lastEditPosition, setLastEditPosition] = useState<LastEditPosition | null>(null);

  const currentDocRef = useRef<Document | null>(null);
  const blockIdsRef = useRef<string[]>([]);
  const [pendingScrollBlockId, setPendingScrollBlockId] = useState<string | null>(null);

  const resetSaveState = useCallback((status: SaveStatus = "idle") => {
    setSaveStatus(status);
    setLastSavedAt(null);
    setHasUnsavedChanges(false);
  }, []);

  const currentDocSlug = useMemo(
    () => (currentDoc ? encodeDocId(currentDoc.docId) : null),
    [currentDoc],
  );

  const setCurrentDocument = useCallback((doc: Document, status: SaveStatus = "loaded") => {
    setCurrentDoc(doc);
    setCurrentDocVersion(null);
    setCurrentContentSource(null);
    setCurrentDraftMeta(null);
    setCurrentSyncSession(null);
    setCurrentBlockIds([]);
    setLastEditPosition(null);
    currentDocRef.current = doc;
    resetSaveState(status);
  }, [resetSaveState]);

  const setWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    localStorage.setItem(WORKSPACE_KEY, id);
    setCurrentDoc(null);
    setCurrentDocVersion(null);
    setCurrentContentSource(null);
    setCurrentDraftMeta(null);
    setCurrentSyncSession(null);
    setCurrentBlockIds([]);
    setLastEditPosition(null);
    currentDocRef.current = null;
    setDocuments([]);
    resetSaveState();
  }, [resetSaveState]);

  const clearWorkspace = useCallback(() => {
    setWorkspaceId(null);
    localStorage.removeItem(WORKSPACE_KEY);
    setCurrentDoc(null);
    setCurrentDocVersion(null);
    setCurrentContentSource(null);
    setCurrentDraftMeta(null);
    setCurrentSyncSession(null);
    setCurrentBlockIds([]);
    setLastEditPosition(null);
    currentDocRef.current = null;
    setDocuments([]);
    resetSaveState();
  }, [resetSaveState]);

  const refreshDocs = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await apiListDocs({
        workspaceId,
        sortBy: "updatedAt",
        sortOrder: "DESC",
      });
      setDocuments(res.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("工作空间不存在")) {
        clearWorkspace();
      }
      throw e;
    }
  }, [workspaceId, clearWorkspace]);

  const selectDoc = useCallback(async (docId: string) => {
    const doc = await getDocument(docId);
    if (!belongsToWorkspace(doc, workspaceId)) {
      throw new Error("文档不属于当前工作空间");
    }
    setCurrentDocument(doc);
    pushWindowPath(doc.docId);
  }, [setCurrentDocument, workspaceId]);

  const selectDocAndScroll = useCallback(async (docId: string, blockId: string) => {
    const doc = await getDocument(docId);
    if (!belongsToWorkspace(doc, workspaceId)) {
      throw new Error("文档不属于当前工作空间");
    }
    setPendingScrollBlockId(blockId);
    setCurrentDocument(doc);
    pushWindowPath(doc.docId);
  }, [setCurrentDocument, workspaceId]);

  const loadContent = useCallback(async (docId: string): Promise<{ content: EditorContent; docVer: number; syncSession: SyncSessionMeta | null }> => {
    const { content, blockIds, docVer, source, draft, lastEditPosition, syncSession } = await loadDocumentContentV2(docId);
    blockIdsRef.current = blockIds;
    setCurrentBlockIds(blockIds);
    setCurrentDocVersion(docVer);
    setCurrentContentSource(source);
    setCurrentDraftMeta(draft);
    setCurrentSyncSession(syncSession ?? null);
    setLastEditPosition(lastEditPosition);
    return { content, docVer, syncSession: syncSession ?? null };
  }, []);

  const syncDocumentMetadata = useCallback((updated: Document) => {
    if (currentDocRef.current?.docId === updated.docId) {
      currentDocRef.current = updated;
      setCurrentDoc(updated);
    }
    setDocuments((prev) =>
      prev.map((doc) => (doc.docId === updated.docId ? updated : doc)),
    );
  }, []);

  const applyCommittedVersion = useCallback((version: number, draftRevision?: number | null) => {
    const current = currentDocRef.current;
    if (current) {
      const updated = { ...current, head: version };
      currentDocRef.current = updated;
      setCurrentDoc(updated);
      setDocuments((prev) =>
        prev.map((doc) => (doc.docId === updated.docId ? { ...doc, head: version } : doc)),
      );
    }

    setCurrentDocVersion(version);
    setCurrentContentSource("head");
    setCurrentDraftMeta((currentDraft) => ({
      exists: false,
      draftRevision: draftRevision ?? currentDraft?.draftRevision ?? 0,
    }));
  }, []);

  const createDoc = useCallback(
    async (data: { title: string; icon?: string; cover?: string; visibility?: string; category?: string }): Promise<Document> => {
      if (!workspaceId) throw new Error("未选择工作空间");
      const doc = await apiCreateDoc({ workspaceId, ...data });
      setCurrentDoc(doc);
      setCurrentDocVersion(doc.head);
      currentDocRef.current = doc;
      setDocuments((prev) => [doc, ...prev]);
      resetSaveState("loaded");
      setCurrentContentSource("head");
      setCurrentDraftMeta(null);
      setCurrentSyncSession(null);
      setCurrentBlockIds([]);
      setLastEditPosition(null);
      pushWindowPath(doc.docId);
      return doc;
    },
    [resetSaveState, workspaceId],
  );

  const updateDoc = useCallback(
    async (docId: string, data: { title?: string; icon?: string; cover?: string; visibility?: string; tags?: string[]; category?: string; status?: string }) => {
      const updated = await apiUpdateDoc(docId, data);
      setCurrentDoc(updated);
      setCurrentDocVersion(updated.head);
      setCurrentContentSource("head");
      currentDocRef.current = updated;
      setDocuments((prev) =>
        prev.map((d) => (d.docId === docId ? updated : d)),
      );
      resetWindowPath(updated.docId);
    },
    [],
  );

  const deleteDoc = useCallback(
    async (docId: string) => {
      await apiDeleteDoc(docId);
      if (currentDocRef.current?.docId === docId) {
        setCurrentDoc(null);
        setCurrentDocVersion(null);
        setCurrentContentSource(null);
        setCurrentDraftMeta(null);
        setCurrentSyncSession(null);
        setCurrentBlockIds([]);
        setLastEditPosition(null);
        currentDocRef.current = null;
        resetSaveState();
        resetWindowPath();
      }
      setDocuments((prev) => prev.filter((d) => d.docId !== docId));
    },
    [resetSaveState],
  );

  const publishDoc = useCallback(
    async (docId: string): Promise<PublishDocumentResult> => {
      const result = await apiPublishDoc(docId);
      syncDocumentMetadata(result.document);
      resetWindowPath(result.document.docId);
      return result;
    },
    [syncDocumentMetadata],
  );

  const publishDocVersion = useCallback(
    async (docId: string, version: number): Promise<PublishDocumentResult> => {
      const result = await apiPublishDocVersion(docId, version);
      syncDocumentMetadata(result.document);
      return result;
    },
    [syncDocumentMetadata],
  );

  const unpublishDoc = useCallback(
    async (docId: string): Promise<PublishDocumentResult> => {
      const result = await apiUnpublishDoc(docId);
      syncDocumentMetadata(result.document);
      return result;
    },
    [syncDocumentMetadata],
  );

  const getBlockId = useCallback((): string | undefined => {
    return undefined;
  }, []);

  return (
    <DocumentContext.Provider
      value={{
        workspaceId,
        currentDoc,
        currentDocSlug,
        documents,
        saveStatus,
        lastSavedAt,
        hasUnsavedChanges,
        currentDocVersion,
        currentContentSource,
        currentDraftMeta,
        currentSyncSession,
        currentBlockIds,
        lastEditPosition,
        pendingScrollBlockId,
        setWorkspace,
        clearWorkspace,
        selectDoc,
        selectDocAndScroll,
        loadContent,
        applyCommittedVersion,
        markSavedAt: setLastSavedAt,
        setSaveStatus,
        setHasUnsavedChanges,
        setPendingScrollBlockId,
        createDoc,
        updateDoc,
        deleteDoc,
        publishDoc,
        publishDocVersion,
        unpublishDoc,
        syncDocumentMetadata,
        refreshDocs,
        getBlockId,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx)
    throw new Error("useDocument must be used within DocumentProvider");
  return ctx;
}
