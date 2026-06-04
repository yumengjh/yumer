import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    orderedListStyle: {
      setOrderedListStyle: (listStyleType: string) => ReturnType;
      unsetOrderedListStyle: () => ReturnType;
    };
  }
}

export interface OrderedListStyleOptions {
  types: string[];
}

export const OrderedListStyle = Node.create<OrderedListStyleOptions>({
  name: "orderedListStyle",

  addOptions() {
    return {
      types: ["orderedList"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          listStyleType: {
            default: "decimal",
            parseHTML: (element) => {
              const style = element.style.listStyleType;
              if (style) {
                return style;
              }
              return "decimal";
            },
            renderHTML: (attributes) => {
              if (!attributes.listStyleType || attributes.listStyleType === "decimal") {
                return {};
              }
              return {
                style: `list-style-type: ${attributes.listStyleType}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setOrderedListStyle:
        (listStyleType: string) =>
        ({ commands }) => {
          return commands.updateAttributes("orderedList", { listStyleType });
        },
      unsetOrderedListStyle:
        () =>
        ({ commands }) => {
          return commands.updateAttributes("orderedList", { listStyleType: "decimal" });
        },
    };
  },
});
