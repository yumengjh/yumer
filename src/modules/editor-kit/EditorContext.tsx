import { createContext, useContext } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorImageUploadHandler } from "./types";

interface EditorContextValue {
  editor: Editor | null;
  defaultFontSize: string;
  uploadImage: EditorImageUploadHandler | null;
}

const EditorContext = createContext<EditorContextValue>({
  editor: null,
  defaultFontSize: "15px",
  uploadImage: null,
});

export const EditorContextProvider = EditorContext.Provider;

export const useMarkdownEditor = (): Editor | null => {
  return useContext(EditorContext).editor;
};

export const useMarkdownEditorContext = (): EditorContextValue => {
  return useContext(EditorContext);
};
