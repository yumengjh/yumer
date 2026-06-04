// @vitest-environment jsdom

import { createElement, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { buildLocalDocSnapshot } from "@/services/local-snapshot";
import {
  useLocalDocumentSnapshot,
  type LocalSnapshotState,
} from "./useLocalDocumentSnapshot";

const storedDoc: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { clientId: "client_a" },
      content: [{ type: "text", text: "stored snapshot" }],
    },
  ],
};

const loadedDoc: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { clientId: "client_a" },
      content: [{ type: "text", text: "loaded after refresh" }],
    },
  ],
};

const editedDoc: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { clientId: "client_a" },
      content: [{ type: "text", text: "edited with auto save enabled" }],
    },
  ],
};

function SnapshotHarness(props: {
  docId: string;
  content: TiptapDoc;
  autoSave: boolean;
  hasUnsavedChanges?: boolean;
  onState: (state: LocalSnapshotState) => void;
}) {
  const snapshot = useLocalDocumentSnapshot({
    docId: props.docId,
    content: props.content,
    enabled: true,
    autoSave: props.autoSave,
    hasUnsavedChanges: props.hasUnsavedChanges,
  });

  useEffect(() => {
    props.onState(snapshot.state);
  }, [props, snapshot.state]);

  return null;
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useLocalDocumentSnapshot", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // React 19 requires an explicit act-enabled test environment flag.
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flushEffects();
    });
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("switches from mismatch to saving immediately when auto-save captures a new edit", async () => {
    localStorage.setItem(
      "yuediter:local-snapshot:doc_1",
      JSON.stringify(buildLocalDocSnapshot("doc_1", storedDoc, 1000)),
    );

    let latestState: LocalSnapshotState | null = null;
    const onState = (state: LocalSnapshotState) => {
      latestState = state;
    };

    await act(async () => {
      root.render(createElement(SnapshotHarness, {
        docId: "doc_1",
        content: loadedDoc,
        autoSave: true,
        hasUnsavedChanges: false,
        onState,
      }));
      await flushEffects();
    });

    expect(latestState?.status).toBe("mismatch");

    await act(async () => {
      root.render(createElement(SnapshotHarness, {
        docId: "doc_1",
        content: editedDoc,
        autoSave: true,
        hasUnsavedChanges: true,
        onState,
      }));
      await flushEffects();
    });

    expect(latestState?.status).toBe("saving");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await flushEffects();
    });

    const storedSnapshot = JSON.parse(
      localStorage.getItem("yuediter:local-snapshot:doc_1") ?? "null",
    ) as { content?: TiptapDoc } | null;
    expect(storedSnapshot?.content).toEqual(editedDoc);
  });

  it("does not enter saving when content changes but the document is not in an unsaved edit state", async () => {
    localStorage.setItem(
      "yuediter:local-snapshot:doc_1",
      JSON.stringify(buildLocalDocSnapshot("doc_1", storedDoc, 1000)),
    );

    let latestState: LocalSnapshotState | null = null;
    const onState = (state: LocalSnapshotState) => {
      latestState = state;
    };

    await act(async () => {
      root.render(createElement(SnapshotHarness, {
        docId: "doc_1",
        content: loadedDoc,
        autoSave: true,
        hasUnsavedChanges: false,
        onState,
      }));
      await flushEffects();
    });

    expect(latestState?.status).toBe("mismatch");

    await act(async () => {
      root.render(createElement(SnapshotHarness, {
        docId: "doc_1",
        content: editedDoc,
        autoSave: true,
        hasUnsavedChanges: false,
        onState,
      }));
      await flushEffects();
    });

    expect(latestState?.status).toBe("mismatch");
  });
});
