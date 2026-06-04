export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

export type EditorContent = string | TiptapDoc;

export interface UploadedImageAsset {
  imageId: string;
  url?: string;
  publicUrl?: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt?: string;
}

export type EditorImageUploadHandler = (
  file: File,
) => Promise<UploadedImageAsset>;
