import type { EditorCleanupActionKey } from "../code/editorCleanup";

export const titleLevelItems = [
  { key: "0", label: "正文", shortcut: "Alt Ctrl 0", size: "body" as const },
  { key: "1", label: "标题1", shortcut: "Alt Ctrl 1", size: "h1" as const },
  { key: "2", label: "标题2", shortcut: "Alt Ctrl 2", size: "h2" as const },
  { key: "3", label: "标题3", shortcut: "Alt Ctrl 3", size: "h3" as const },
  { key: "4", label: "标题4", shortcut: "Alt Ctrl 4", size: "h4" as const },
  { key: "5", label: "标题5", shortcut: "Alt Ctrl 5", size: "h5" as const },
  { key: "6", label: "标题6", shortcut: "Alt Ctrl 6", size: "h6" as const },
];

export const fontSizeItems = [
  "13px",
  "14px",
  "15px",
  "16px",
  "19px",
  "22px",
  "24px",
  "29px",
  "32px",
  "40px",
  "48px",
].map((size) => ({
  key: size,
  label: size,
}));

export const codeLanguageItems = [
  { key: "text", label: "Plain Text" },
  { key: "javascript", label: "JavaScript" },
  { key: "typescript", label: "TypeScript" },
  { key: "tsx", label: "TSX" },
  { key: "json", label: "JSON" },
  { key: "bash", label: "Bash" },
  { key: "html", label: "HTML" },
  { key: "css", label: "CSS" },
  { key: "sql", label: "SQL" },
  { key: "yaml", label: "YAML" },
  { key: "python", label: "Python" },
  { key: "java", label: "Java" },
  { key: "go", label: "Go" },
  { key: "rust", label: "Rust" },
].map((item) => ({
  key: item.key,
  label: item.label,
}));

export const codeCleanupItems: readonly CodeCleanupMenuItem[] = [
  { key: "removeTrailingBlankLines", label: "删除行尾空行" },
  { key: "removeEmptyCodeBlocks", label: "删除空代码块" },
  { key: "convertSelectedListsToInline", label: "列表转横排（中文逗号）" },
  { key: "divider-content", type: "divider" },
  { key: "collapseStatusBars", label: "折叠状态栏" },
  { key: "expandStatusBars", label: "展开状态栏" },
  { key: "divider-display", type: "divider" },
  { key: "enableLineNumbers", label: "启用行号" },
  { key: "disableLineNumbers", label: "禁用行号" },
] as const;

export type CodeCleanupMenuItem =
  | { key: EditorCleanupActionKey; label: string }
  | { key: string; type: "divider" };

export const orderedListTypeItems = [
  { key: "decimal", label: "1", description: "数字" },
  { key: "lower-alpha", label: "a", description: "小写字母" },
  { key: "upper-alpha", label: "A", description: "大写字母" },
  { key: "lower-roman", label: "i", description: "小写罗马数字" },
  { key: "upper-roman", label: "II", description: "大写罗马数字" },
].map((item) => ({
  key: item.key,
  label: item.label,
  description: item.description,
}));

export const lineHeightItems = [
  { key: "", label: "默认" },
  { key: "1", label: "1" },
  { key: "1.15", label: "1.15" },
  { key: "1.5", label: "1.5" },
  { key: "2", label: "2" },
  { key: "2.5", label: "2.5" },
  { key: "3", label: "3" },
].map((item) => ({
  key: item.key,
  label: item.label,
}));

export const highlightBlockColors = [
  "#FFF2CC",
  "#FCE5CD",
  "#F4CCCC",
  "#E6B8AF",
  "#D9EAD3",
  "#D0E0E3",
  "#C9DAF8",
  "#CFE2F3",
  "#D9D2E9",
  "#EAD1DC",
];

export const defaultHighlightBlockColor = "#FFF2CC";

export const highlightBlockColorTypeMap: Record<string, string> = {
  "#FFF2CC": "tip",
  "#FCE5CD": "warning",
  "#F4CCCC": "danger",
  "#E6B8AF": "caution",
  "#D9EAD3": "success",
  "#D0E0E3": "info",
  "#C9DAF8": "note",
  "#CFE2F3": "question",
  "#D9D2E9": "example",
  "#EAD1DC": "quote",
};

export const highlightBlockTypeColorMap: Record<string, string> = Object.fromEntries(
  Object.entries(highlightBlockColorTypeMap).map(([color, type]) => [type, color]),
);

export function getColorByType(type: string): string {
  return highlightBlockTypeColorMap[type] || defaultHighlightBlockColor;
}

export function getTypeByColor(color: string): string {
  return highlightBlockColorTypeMap[color] || "tip";
}

export const defaultColor = "#000000";

export const solidColors = [
  ["#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#FFFFFF"],
  ["#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF"],
  ["#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC"],
  ["#DD7E6B", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD"],
  ["#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0"],
  ["#A61C00", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3C78D8", "#3D85C6", "#674EA7", "#A64D79"],
];

export const gradientColors = [
  { id: "gradient-1", colors: ["#4A86E8", "#9900FF"] },
  { id: "gradient-2", colors: ["#9900FF", "#FF00FF"] },
  { id: "gradient-3", colors: ["#FF9900", "#FF00FF"] },
  { id: "gradient-4", colors: ["#FF9900", "#FFFF00"] },
];
