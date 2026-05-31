export const FLOATING_TOOLBAR_ITEMS = [
  { id: "bold", label: "加粗", defaultEnabled: true },
  { id: "italic", label: "斜体", defaultEnabled: true },
  { id: "underline", label: "下划线", defaultEnabled: true },
  { id: "strike", label: "删除线", defaultEnabled: true },
  { id: "text-color", label: "文字颜色", defaultEnabled: true },
  { id: "bg-color", label: "背景色", defaultEnabled: true },
  { id: "link", label: "链接", defaultEnabled: true },
  { id: "clearFormat", label: "清除格式", defaultEnabled: true },
] as const;

export type FloatingToolbarItemId = (typeof FLOATING_TOOLBAR_ITEMS)[number]["id"];
