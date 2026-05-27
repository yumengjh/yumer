import { Extension } from "@tiptap/core";
import { BLOCK_IDENTITY_NODE_TYPES } from "@/services/sync/identity";

/**
 * 为所有块级节点注册 data-block-id 全局属性，
 * 使 ProseMirror 在解析/渲染 HTML 时保留服务器块 ID。
 */
export const BlockIdAttribute = Extension.create({
  name: "blockIdAttribute",

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_IDENTITY_NODE_TYPES],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("blockId") ?? element.getAttribute("data-block-id"),
            renderHTML: (attributes) => {
              const blockId = attributes.blockId ?? attributes["data-block-id"];
              if (!blockId) return {};
              return {
                blockId,
                "data-block-id": blockId,
              };
            },
          },
          clientId: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("clientId") ?? element.getAttribute("data-client-id"),
            renderHTML: (attributes) => {
              const clientId = attributes.clientId ?? attributes["data-client-id"];
              if (!clientId) return {};
              return {
                clientId,
                "data-client-id": clientId,
              };
            },
          },
          sortKey: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("sortKey") ?? element.getAttribute("data-sort-key"),
            renderHTML: (attributes) => {
              const sortKey = attributes.sortKey ?? attributes["data-sort-key"];
              if (!sortKey) return {};
              return {
                sortKey,
                "data-sort-key": sortKey,
              };
            },
          },
        },
      },
    ];
  },
});
