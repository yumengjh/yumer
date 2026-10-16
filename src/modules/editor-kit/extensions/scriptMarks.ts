import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    superscript: {
      toggleSuperscript: () => ReturnType;
    };
    subscript: {
      toggleSubscript: () => ReturnType;
    };
  }
}

/** 上标（语雀「更多文本样式」），与下标互斥 */
export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",

  parseHTML() {
    return [{ tag: "sup" }, { style: "vertical-align", getAttrs: (value) => (value === "super" ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleSuperscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-.": () => this.editor.commands.toggleSuperscript(),
    };
  },
});

/** 下标（语雀「更多文本样式」），与上标互斥 */
export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",

  parseHTML() {
    return [{ tag: "sub" }, { style: "vertical-align", getAttrs: (value) => (value === "sub" ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleSubscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-,": () => this.editor.commands.toggleSubscript(),
    };
  },
});
