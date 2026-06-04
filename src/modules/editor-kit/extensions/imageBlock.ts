import { Node, mergeAttributes } from "@tiptap/core";

export type ImageAlign = "left" | "center" | "right";
export type ImageLinkTarget = "_self" | "_blank";
export type ImageStyleOption = "shadow" | "border" | "rounded";

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageBlockAttrs {
  imageId: string;
  src: string;
  filename: string;
  mimeType: string;
  size: number;
  naturalWidth: number | null;
  naturalHeight: number | null;
  width: number | null;
  height: number | null;
  alt: string;
  align: ImageAlign;
  rotate: 0 | 90 | 180 | 270;
  crop: ImageCrop | null;
  styles: ImageStyleOption[];
  linkHref: string;
  linkTarget: ImageLinkTarget;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageBlock: {
      insertImageBlock: (attrs: Partial<ImageBlockAttrs>) => ReturnType;
      updateImageBlockAttrs: (attrs: Partial<ImageBlockAttrs>) => ReturnType;
    };
  }
}

const DEFAULT_ATTRS: ImageBlockAttrs = {
  imageId: "",
  src: "",
  filename: "",
  mimeType: "",
  size: 0,
  naturalWidth: null,
  naturalHeight: null,
  width: null,
  height: null,
  alt: "",
  align: "left",
  rotate: 0,
  crop: null,
  styles: [],
  linkHref: "",
  linkTarget: "_self",
};

export function normalizeImageBlockAttrs(attrs: Record<string, unknown> = {}): ImageBlockAttrs {
  const width = normalizePositiveNumber(attrs.width);
  const height = normalizePositiveNumber(attrs.height);
  return {
    imageId: normalizeString(attrs.imageId),
    src: normalizeString(attrs.src),
    filename: normalizeString(attrs.filename),
    mimeType: normalizeString(attrs.mimeType),
    size: normalizeNonNegativeNumber(attrs.size) ?? 0,
    naturalWidth: normalizePositiveNumber(attrs.naturalWidth),
    naturalHeight: normalizePositiveNumber(attrs.naturalHeight),
    width,
    height,
    alt: normalizeString(attrs.alt),
    align: normalizeAlign(attrs.align),
    rotate: normalizeRotate(attrs.rotate),
    crop: normalizeCrop(attrs.crop),
    styles: normalizeStyles(attrs.styles),
    linkHref: normalizeLinkHref(attrs.linkHref),
    linkTarget: attrs.linkTarget === "_blank" ? "_blank" : "_self",
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeLinkHref(value: unknown): string {
  const href = normalizeString(value).trim();
  if (!href) return "";
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^[#/?]/.test(href)) return href;
  return "";
}

function normalizePositiveNumber(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.round(numeric);
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.round(numeric);
}

function normalizeAlign(value: unknown): ImageAlign {
  if (value === "center" || value === "right") return value;
  return "left";
}

function normalizeRotate(value: unknown): 0 | 90 | 180 | 270 {
  const numeric = typeof value === "string" ? Number(value) : value;
  const normalized = (((Number(numeric) || 0) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function normalizeCrop(value: unknown): ImageCrop | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = clampPercent(raw.x);
  const y = clampPercent(raw.y);
  const width = clampPercent(raw.width);
  const height = clampPercent(raw.height);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function normalizeStyles(value: unknown): ImageStyleOption[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.trim().startsWith("[")
        ? safeParseArray(value)
        : value.split(",")
      : [];
  const allowed = new Set<ImageStyleOption>(["shadow", "border", "rounded"]);
  return Array.from(new Set(raw.filter((item): item is ImageStyleOption => allowed.has(item as ImageStyleOption))));
}

function safeParseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampPercent(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function renderStyle(attrs: ImageBlockAttrs): string {
  const styles = [`--image-rotate: ${attrs.rotate}deg`];
  if (attrs.crop) {
    styles.push(`--image-crop-x: ${attrs.crop.x}%`);
    styles.push(`--image-crop-y: ${attrs.crop.y}%`);
    styles.push(`--image-crop-width: ${attrs.crop.width}%`);
    styles.push(`--image-crop-height: ${attrs.crop.height}%`);
  }
  return styles.join("; ");
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export const ImageBlock = Node.create({
  name: "imageBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return Object.fromEntries(
      Object.keys(DEFAULT_ATTRS).map((key) => [
        key,
        {
          default: DEFAULT_ATTRS[key as keyof ImageBlockAttrs],
          parseHTML: (element: HTMLElement) => {
            if (key === "crop") {
              const crop = element.getAttribute("data-crop");
              if (!crop) return null;
              try {
                return JSON.parse(crop);
              } catch {
                return null;
              }
            }
            const value = element.getAttribute(`data-${key}`) ?? element.getAttribute(key);
            return value ?? DEFAULT_ATTRS[key as keyof ImageBlockAttrs];
          },
        },
      ]),
    );
  },

  parseHTML() {
    return [{ tag: "figure[data-image-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = normalizeImageBlockAttrs(HTMLAttributes);
    const sourceWidth = attrs.width || attrs.naturalWidth || 320;
    const sourceHeight = attrs.height || attrs.naturalHeight || 180;
    const visibleWidth = attrs.crop ? Math.max(1, Math.round(sourceWidth * attrs.crop.width / 100)) : sourceWidth;
    const visibleHeight = attrs.crop ? Math.max(1, Math.round(sourceHeight * attrs.crop.height / 100)) : sourceHeight;
    const rotatedSideways = attrs.rotate === 90 || attrs.rotate === 270;
    const layoutWidth = rotatedSideways ? visibleHeight : visibleWidth;
    const layoutHeight = rotatedSideways ? visibleWidth : visibleHeight;
    const cropWindowWidth = percent(visibleWidth / layoutWidth);
    const cropWindowHeight = percent(visibleHeight / layoutHeight);
    const imageWidth = percent(sourceWidth / visibleWidth);
    const imageHeight = percent(sourceHeight / visibleHeight);
    const imageOffsetX = attrs.crop ? percent(-attrs.crop.x / attrs.crop.width) : "0%";
    const imageOffsetY = attrs.crop ? percent(-attrs.crop.y / attrs.crop.height) : "0%";
    const imgAttrs: Record<string, unknown> = {
      src: attrs.src,
      alt: attrs.alt,
      loading: "lazy",
      style: `width:${imageWidth};height:${imageHeight};transform:translate(${imageOffsetX}, ${imageOffsetY})`,
    };

    const image = [
      "span",
      {
        class: "image-layout-box",
        style: `width:100%;max-width:${layoutWidth}px;aspect-ratio:${layoutWidth}/${layoutHeight}`,
      },
      [
        "span",
        {
          class: ["image-crop-window", ...attrs.styles.map((style) => `image-crop-window--${style}`)].join(" "),
          style: `width:${cropWindowWidth};height:${cropWindowHeight};transform:translate(-50%, -50%) rotate(${attrs.rotate}deg)`,
        },
        ["img", imgAttrs],
      ],
    ];
    const content = attrs.linkHref
      ? [
          "a",
          {
            href: attrs.linkHref,
            target: attrs.linkTarget,
            rel: attrs.linkTarget === "_blank" ? "noopener noreferrer" : null,
          },
          image,
        ]
      : image;

    return [
      "figure",
      mergeAttributes(HTMLAttributes.class ? { class: HTMLAttributes.class } : {}, {
        "data-image-block": "",
        "data-image-id": attrs.imageId,
        "data-align": attrs.align,
        "data-crop": attrs.crop ? JSON.stringify(attrs.crop) : null,
        "data-styles": attrs.styles.length > 0 ? JSON.stringify(attrs.styles) : null,
        style: renderStyle(attrs),
      }),
      content,
    ];
  },

  addCommands() {
    return {
      insertImageBlock:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: normalizeImageBlockAttrs(attrs as Record<string, unknown>),
          });
        },
      updateImageBlockAttrs:
        (attrs) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, attrs);
        },
    };
  },
});
