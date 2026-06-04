import { Extension } from "@tiptap/core";

type TiptapChain = {
  setMark: (name: string, attrs: Record<string, unknown>) => TiptapChain;
  removeEmptyTextStyle: () => TiptapChain;
  run: () => boolean;
};

export const createFontSizeExtension = () => {
  return Extension.create({
    name: "fontSize",
    addOptions() {
      return {
        types: ["textStyle"],
      };
    },
    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            fontSize: {
              default: null,
              parseHTML: (element: HTMLElement) => {
                const fontSize = element.style.fontSize;
                if (fontSize) {
                  return fontSize.replace("px", "");
                }
                return null;
              },
              renderHTML: (attributes: Record<string, unknown>) => {
                if (!attributes.fontSize) {
                  return {};
                }
                return {
                  style: `font-size: ${attributes.fontSize}px`,
                };
              },
            },
          },
        },
      ];
    },
    addCommands() {
      return {
        setFontSize:
          (fontSize: string) =>
          ({ chain }: { chain: () => TiptapChain }) => {
            return chain().setMark("textStyle", { fontSize }).run();
          },
        unsetFontSize:
          () =>
          ({ chain }: { chain: () => TiptapChain }) => {
            return chain()
              .setMark("textStyle", { fontSize: null })
              .removeEmptyTextStyle()
              .run();
          },
      };
    },
  });
};
