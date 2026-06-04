import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

const MAX_INDENT = 8;
const INDENT_STEP = 1;

export const Indent = Extension.create({
  name: "indent",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
      minLevel: 0,
      maxLevel: MAX_INDENT,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const level = parseInt(element.style.paddingLeft, 10) / INDENT_STEP || 0;
              return Math.min(Math.max(level, 0), this.options.maxLevel);
            },
            renderHTML: (attributes) => {
              if (!attributes.indent || attributes.indent <= 0) return {};
              return { style: `padding-left: ${attributes.indent * INDENT_STEP}em` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          let modified = false;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!this.options.types.includes(node.type.name)) return;
            const currentIndent = node.attrs.indent || 0;
            if (currentIndent >= this.options.maxLevel) return;
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              indent: currentIndent + INDENT_STEP,
            });
            modified = true;
          });

          if (modified && dispatch) dispatch(tr);
          return modified;
        },

      outdent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          let modified = false;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!this.options.types.includes(node.type.name)) return;
            const currentIndent = node.attrs.indent || 0;
            if (currentIndent <= this.options.minLevel) return;
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              indent: currentIndent - INDENT_STEP,
            });
            modified = true;
          });

          if (modified && dispatch) dispatch(tr);
          return modified;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      "Shift-Tab": () => this.editor.commands.outdent(),
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle paragraphs and headings with indent > 0
        if (!this.options.types.includes(node.type.name)) return false;
        if ((node.attrs.indent || 0) <= 0) return false;

        // Don't override inside list items, blockquotes, or table cells
        for (let d = $from.depth; d >= 0; d--) {
          const ancestor = $from.node(d);
          if (
            ancestor.type.name === "listItem" ||
            ancestor.type.name === "blockquote" ||
            ancestor.type.name === "tableCell" ||
            ancestor.type.name === "tableHeader"
          ) {
            return false;
          }
        }

        // Split the block (creates new paragraph with inherited indent)
        editor.chain().focus().splitBlock().run();

        // Reset indent on the new paragraph (cursor is now inside it)
        const { state: newState } = editor;
        const { $from: newFrom } = newState.selection;
        const newNode = newFrom.parent;
        if (
          this.options.types.includes(newNode.type.name) &&
          (newNode.attrs.indent || 0) > 0
        ) {
          const pos = newFrom.before(newFrom.depth);
          editor.chain()
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...newNode.attrs,
                  indent: 0,
                });
                dispatch(tr);
              }
              return true;
            })
            .run();
        }

        return true;
      },
    };
  },
});
