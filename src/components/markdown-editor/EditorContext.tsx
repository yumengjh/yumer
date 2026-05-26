import { createContext, useContext } from "react";
import type { Editor } from "@tiptap/react";

interface EditorContextValue {
  editor: Editor | null;
  defaultFontSize: string;
  workspaceId: string | null;
}

const EditorContext = createContext<EditorContextValue>({
  editor: null,
  defaultFontSize: "15px",
  workspaceId: null,
});

export const EditorContextProvider = EditorContext.Provider;

export const useMarkdownEditor = (): Editor | null => {
  return useContext(EditorContext).editor;
};

export const useMarkdownEditorContext = (): EditorContextValue => {
  return useContext(EditorContext);
};
