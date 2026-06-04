/**
 * Markdown Shortcuts Extension
 * ============================
 * 可扩展的 Markdown 快捷输入系统。
 *
 * 设计理念：
 * - 所有行内 Markdown 语法（如 `code`、**bold**、*italic*）都在用户按下空格后触发
 * - 通过 MarkdownShortcutRule 接口定义规则，方便扩展自定义语法
 * - 规则按优先级（priority）排序，高优先级先匹配
 * - 触发后光标自动移到格式化内容之后（不会留在标记内部）
 *
 * 扩展指南：
 * 1. 行内 Mark 类（加粗、斜体等）→ 使用 createInlineMarkRule 工厂函数
 * 2. 自定义规则 → 实现 MarkdownShortcutRule 接口，传入 customRules
 * 3. 块级规则 → 实现 action 函数，在其中操作 block 节点
 */

import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MarkType, Schema } from "prosemirror-model";

/* ------------------------------------------------------------------ */
/*  Rule 接口定义                                                       */
/* ------------------------------------------------------------------ */

export interface MarkdownShortcutRule {
  /** 规则唯一标识 */
  name: string;
  /** 优先级，数值越大越先匹配（默认 0） */
  priority?: number;
  /** 触发按键：空格（默认）或回车 */
  triggerKey?: " " | "Enter";
  /**
   * 正则表达式，匹配光标前的文本。
   * - 必须以 $ 结尾（匹配到光标位置）
   * - 捕获组 [1] 应为实际内容
   */
  pattern: RegExp;
  /**
   * 匹配后执行的操作。
   * 返回 true 表示已处理，false 则继续尝试下一条规则。
   */
  action: (ctx: ShortcutActionContext) => boolean;
}

export interface ShortcutActionContext {
  match: RegExpMatchArray;
  view: EditorView;
  /** 匹配文本在文档中的起始位置 */
  from: number;
  /** 匹配文本在文档中的结束位置（光标处） */
  to: number;
}

/* ------------------------------------------------------------------ */
/*  工具函数：创建行内 Mark 规则                                          */
/* ------------------------------------------------------------------ */

/**
 * 快捷创建"行内标记"类规则的工厂函数。
 *
 * 适用场景：行内代码、加粗、斜体、删除线等。
 * 行为：将匹配的 Markdown 语法替换为带 mark 的文本 + 一个尾随空格，
 *       光标定位在内容末尾（mark 边界），并清除 storedMarks
 *       确保后续输入不会继承该 mark。
 *
 * @param name        规则名称
 * @param pattern     匹配正则（捕获组 [1] = 实际内容）
 * @param getMarkType 从 schema 中获取对应 MarkType
 * @param priority    优先级（默认 0）
 */
export function createInlineMarkRule(
  name: string,
  pattern: RegExp,
  getMarkType: (schema: Schema) => MarkType | null,
  priority = 0,
  /** 触发后清除 storedMarks，使后续输入脱离该 mark（默认 false） */
  clearMark = false,
): MarkdownShortcutRule {
  return {
    name,
    priority,
    pattern,
    action: ({ match, view, from, to }) => {
      const { state } = view;
      const { schema } = state;
      const markType = getMarkType(schema);
      if (!markType) return false;

      const content = match[1];
      if (!content) return false;

      const tr = state.tr;

      // [带 mark 的文本][普通空格] 替换原始 markdown 语法
      const markedText = schema.text(content, [markType.create()]);
      const spaceText = schema.text(" ");
      tr.replaceWith(from, to, [markedText, spaceText]);

      if (clearMark) {
        // 行内代码等：光标跳到空格之后（mark 范围外），清除 mark
        const cursorPos = from + content.length + 1;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        tr.setStoredMarks(null);
      } else {
        // 加粗/斜体等：光标停在内容末尾（留在 mark 内），方便连续输入
        const cursorPos = from + content.length;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
      }

      view.dispatch(tr);
      return true;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  内置规则                                                            */
/* ------------------------------------------------------------------ */

/** 行内代码：`content` + 空格 → <code>content</code> */
export const inlineCodeRule: MarkdownShortcutRule = createInlineMarkRule(
  "inlineCode",
  /`([^`]+)`$/,
  (schema) => schema.marks.code ?? null,
  100,
  true, // 行内代码触发后清除 mark，光标跳出代码范围
);

/** 加粗：**content** + 空格 → <strong>content</strong> */
export const boldRule: MarkdownShortcutRule = createInlineMarkRule(
  "bold",
  /\*\*(.+)\*\*$/,
  (schema) => schema.marks.bold ?? null,
  90,
);

/** 斜体：*content* + 空格 → <em>content</em> */
export const italicRule: MarkdownShortcutRule = createInlineMarkRule(
  "italic",
  /\*([^*]+)\*$/,
  (schema) => schema.marks.italic ?? null,
  80,
);

/** 删除线：~~content~~ + 空格 → <s>content</s> */
export const strikethroughRule: MarkdownShortcutRule = createInlineMarkRule(
  "strikethrough",
  /~~([^~]+)~~$/,
  (schema) => schema.marks.strike ?? null,
  80,
);

/** 水平分割线：--- + 回车 → <hr> */
export const horizontalRuleRule: MarkdownShortcutRule = {
  name: "horizontalRule",
  priority: 70,
  triggerKey: "Enter",
  pattern: /^---$/,
  action: ({ view, from }) => {
    const { state } = view;
    const { schema } = state;
    const hrType = schema.nodes.horizontalRule;
    if (!hrType) return false;

    const tr = state.tr;
    const $from = tr.doc.resolve(from);
    // 用 replaceWith 将整个段落替换为 hr，而非往段落里塞
    tr.replaceWith($from.before(1), $from.after(1), hrType.create());

    // 光标移到 hr 之后；如果 hr 在文档末尾，补一个空段落
    const pos = $from.after(1);
    if (pos >= tr.doc.content.size) {
      const emptyPara = schema.nodes.paragraph.create();
      tr.insert(tr.doc.content.size, emptyPara);
      tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size)));
    } else {
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    }

    view.dispatch(tr);
    return true;
  },
};

/* ------------------------------------------------------------------ */
/*  Extension 创建                                                     */
/* ------------------------------------------------------------------ */

export interface MarkdownShortcutsOptions {
  /**
   * 自定义规则列表。
   * 如果不传，则使用内置规则。
   * 传入后会与内置规则合并（可通过 keepBuiltins 控制）。
   */
  rules?: MarkdownShortcutRule[];
  /** 是否保留内置规则（默认 true） */
  keepBuiltins?: boolean;
}

const BUILTIN_RULES: MarkdownShortcutRule[] = [
  inlineCodeRule,
  boldRule,
  italicRule,
  strikethroughRule,
  horizontalRuleRule,
];

export function createMarkdownShortcutsExtension(
  options: MarkdownShortcutsOptions = {},
) {
  const { rules: customRules = [], keepBuiltins = true } = options;

  // 合并并按 priority 降序排列
  const allRules = [
    ...(keepBuiltins ? BUILTIN_RULES : []),
    ...customRules,
  ].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return Extension.create({
    name: "markdownShortcuts",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
              const key = event.key;
              if (key !== " " && key !== "Enter") return false;

              const { state } = view;
              const { selection } = state;

              // 只在光标折叠（无选区）时处理
              if (!selection.empty) return false;

              const $pos = selection.$from;
              const parentOffset = $pos.parentOffset;

              // 光标在段落开头时无需处理
              if (parentOffset === 0) return false;

              // 获取当前文本块中光标之前的文本
              const textBefore = $pos.parent.textBetween(
                0,
                parentOffset,
                undefined,
                "￼",
              );

              if (!textBefore) return false;

              // 依次尝试每条规则（只匹配触发键相同的）
              for (const rule of allRules) {
                const ruleKey = rule.triggerKey ?? " ";
                if (ruleKey !== key) continue;

                const match = textBefore.match(rule.pattern);
                if (!match || match.index === undefined) continue;

                // 计算文档内匹配区间的绝对位置
                const matchFrom = $pos.start() + match.index;
                const matchTo = $pos.pos;

                const handled = rule.action({
                  match,
                  view,
                  from: matchFrom,
                  to: matchTo,
                });

                if (handled) {
                  event.preventDefault();
                  return true;
                }
              }

              return false;
            },
          },
        }),
      ];
    },
  });
}
