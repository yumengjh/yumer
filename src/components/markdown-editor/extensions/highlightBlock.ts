import { Node, mergeAttributes } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    highlightBlock: {
      insertHighlightBlock: (options?: { backgroundColor?: string }) => ReturnType;
      updateHighlightBlockColor: (color: string) => ReturnType;
      toggleHighlightBlockFromSelection: (options?: { backgroundColor?: string }) => ReturnType;
    };
  }
}

export const DEFAULT_HIGHLIGHT_BLOCK_COLOR = "#FFF2CC";

function cloneBlockWithContent(node: ProseMirrorNode, content: Fragment): ProseMirrorNode {
  return node.type.create(node.attrs, content, node.marks);
}

function createHighlightBlockNode(
  type: ProseMirrorNode["type"],
  attrs: Record<string, unknown> | null | undefined,
  content: readonly ProseMirrorNode[],
): ProseMirrorNode | null {
  if (content.length === 0) return null;
  return type.create(attrs ?? {}, content);
}

function getSingleTextBlockTarget(doc: ProseMirrorNode, from: number, to: number) {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);

  let blockDepth = -1;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      blockDepth = depth;
      break;
    }
  }

  if (blockDepth < 1 || $to.sameParent($from) === false) {
    return null;
  }

  if ($to.depth < blockDepth || $from.before(blockDepth) !== $to.before(blockDepth)) {
    return null;
  }

  const blockNode = $from.node(blockDepth);
  const parentDepth = blockDepth - 1;
  const parentNode = $from.node(parentDepth);

  if (parentNode.type.name !== "doc" && parentNode.type.name !== "highlightBlock") {
    return null;
  }

  const contentFrom = $from.start(blockDepth);
  const contentTo = $from.end(blockDepth);
  const selectionStartsAtBlockStart = from <= contentFrom;
  const selectionEndsAtBlockEnd = to >= contentTo;
  const offsetFrom = Math.max(0, from - contentFrom);
  const offsetTo = Math.max(offsetFrom, to - contentFrom);
  const indexInParent = $from.index(parentDepth);

  return {
    blockDepth,
    blockNode,
    blockPos: $from.before(blockDepth),
    parentDepth,
    parentNode,
    parentPos: parentDepth === 0 ? 0 : $from.before(parentDepth),
    indexInParent,
    offsetFrom,
    offsetTo,
    selectionStartsAtBlockStart,
    selectionEndsAtBlockEnd,
  };
}

export const HighlightBlock = Node.create({
  name: "highlightBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      backgroundColor: {
        default: DEFAULT_HIGHLIGHT_BLOCK_COLOR,
        parseHTML: (element) =>
          element.style.backgroundColor || DEFAULT_HIGHLIGHT_BLOCK_COLOR,
        renderHTML: (attributes) => {
          if (!attributes.backgroundColor) return {};
          return { style: `background-color: ${attributes.backgroundColor}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-highlight-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-highlight-block": "" }),
      0,
    ];
  },

  addCommands() {
    return {
      insertHighlightBlock:
        (options) =>
        ({ commands }) => {
          const color =
            options?.backgroundColor || DEFAULT_HIGHLIGHT_BLOCK_COLOR;
          return commands.insertContent({
            type: this.name,
            attrs: { backgroundColor: color },
            content: [{ type: "paragraph" }],
          });
        },
      updateHighlightBlockColor:
        (color) =>
        ({ commands }) => {
          return commands.updateAttributes("highlightBlock", {
            backgroundColor: color,
          });
        },
      toggleHighlightBlockFromSelection:
        (options) =>
        ({ state, dispatch }) => {
          const { selection, schema } = state;
          if (selection.empty) return false;

          const target = getSingleTextBlockTarget(state.doc, selection.from, selection.to);
          if (!target) return false;

          const {
            blockNode,
            blockPos,
            parentNode,
            parentPos,
            indexInParent,
            offsetFrom,
            offsetTo,
            selectionStartsAtBlockStart,
            selectionEndsAtBlockEnd,
          } = target;

          const beforeContent = blockNode.content.cut(0, offsetFrom);
          const selectedContent = blockNode.content.cut(offsetFrom, offsetTo);
          const afterContent = blockNode.content.cut(offsetTo, blockNode.content.size);

          if (selectedContent.size === 0) {
            return false;
          }

          const beforeBlock = beforeContent.size > 0
            ? cloneBlockWithContent(blockNode, beforeContent)
            : null;
          const selectedBlock = cloneBlockWithContent(blockNode, selectedContent);
          const afterBlock = afterContent.size > 0
            ? cloneBlockWithContent(blockNode, afterContent)
            : null;

          const tr = state.tr;

          if (parentNode.type.name === "doc") {
            const highlightNode = createHighlightBlockNode(
              schema.nodes.highlightBlock,
              {
                backgroundColor:
                  options?.backgroundColor || DEFAULT_HIGHLIGHT_BLOCK_COLOR,
              },
              [selectedBlock],
            );
            if (!highlightNode) return false;

            const replacements = [
              ...(beforeBlock ? [beforeBlock] : []),
              highlightNode,
              ...(afterBlock ? [afterBlock] : []),
            ];

            if (selectionStartsAtBlockStart && selectionEndsAtBlockEnd) {
              tr.replaceWith(blockPos, blockPos + blockNode.nodeSize, highlightNode);
            } else {
              tr.replaceWith(blockPos, blockPos + blockNode.nodeSize, replacements);
            }

            if (dispatch) {
              dispatch(tr.scrollIntoView());
            }
            return true;
          }

          const highlightChildren = parentNode.content.content;
          const beforeSiblings = highlightChildren.slice(0, indexInParent);
          const afterSiblings = highlightChildren.slice(indexInParent + 1);
          const leadingHighlight = createHighlightBlockNode(
            schema.nodes.highlightBlock,
            parentNode.attrs,
            [
              ...beforeSiblings,
              ...(beforeBlock ? [beforeBlock] : []),
            ],
          );
          const trailingHighlight = createHighlightBlockNode(
            schema.nodes.highlightBlock,
            parentNode.attrs,
            [
              ...(afterBlock ? [afterBlock] : []),
              ...afterSiblings,
            ],
          );
          const replacements = [
            ...(leadingHighlight ? [leadingHighlight] : []),
            selectedBlock,
            ...(trailingHighlight ? [trailingHighlight] : []),
          ];

          tr.replaceWith(parentPos, parentPos + parentNode.nodeSize, replacements);

          if (dispatch) {
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});
