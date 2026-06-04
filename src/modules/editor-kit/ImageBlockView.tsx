import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Button, Dropdown, Image, Input, InputNumber, Popover, Select, Space, Tooltip, App } from "antd";
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  CheckOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  FormatPainterOutlined,
  LinkOutlined,
  PictureOutlined,
  RotateRightOutlined,
  ScissorOutlined,
  SwapOutlined,
  MoreOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useMarkdownEditorContext } from "./EditorContext";
import type { ImageBlockAttrs, ImageCrop, ImageStyleOption } from "./extensions/imageBlock";
import "./ImageBlockView.css";

const HIDE_DELAY = 150;
const MIN_CROP_SIZE = 8;
const MIN_IMAGE_WIDTH = 80;
const MIN_IMAGE_HEIGHT = 40;
const IMAGE_STYLE_OPTIONS: { key: ImageStyleOption; label: string }[] = [
  { key: "shadow", label: "阴影" },
  { key: "border", label: "边框" },
  { key: "rounded", label: "圆角" },
];

type CropCorner = "nw" | "ne" | "sw" | "se";
type ResizeCorner = CropCorner;

interface CropDragState {
  corner: CropCorner;
  startX: number;
  startY: number;
  frameWidth: number;
  frameHeight: number;
  crop: ImageCrop;
}

interface ResizeDragState {
  corner: ResizeCorner;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  scale: number;
}

interface ResizeDraft {
  width: number;
  height: number;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeHref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function defaultCrop(): ImageCrop {
  return { x: 0, y: 0, width: 100, height: 100 };
}

function clampCrop(crop: ImageCrop): ImageCrop {
  const width = Math.max(MIN_CROP_SIZE, Math.min(100, crop.width));
  const height = Math.max(MIN_CROP_SIZE, Math.min(100, crop.height));
  const x = Math.max(0, Math.min(100 - width, crop.x));
  const y = Math.max(0, Math.min(100 - height, crop.y));
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}

function isEditableToolbarTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, .ant-input, .ant-input-number, .ant-select, [contenteditable='true']"));
}

function toggleImageStyle(styles: ImageStyleOption[], key: ImageStyleOption): ImageStyleOption[] {
  return styles.includes(key) ? styles.filter((item) => item !== key) : [...styles, key];
}

export default function ImageBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const { message } = App.useApp();
  const { uploadImage } = useMarkdownEditorContext();
  const attrs = node.attrs as ImageBlockAttrs;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  const cropFrameRef = useRef<HTMLSpanElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const resizeDraftRef = useRef<ResizeDraft | null>(null);
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewItems, setPreviewItems] = useState<{ src: string; alt?: string }[]>([]);
  const [cropEditing, setCropEditing] = useState(false);
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState(attrs.linkHref || "");
  const [altDraft, setAltDraft] = useState(attrs.alt || "");
  const [cropDraft, setCropDraft] = useState<ImageCrop>(attrs.crop || defaultCrop());
  const imageSrc = attrs.src || "";

  const collectPreviewItems = useCallback(() => {
    const currentPos = getPos();
    const items: { src: string; alt?: string }[] = [];
    let currentIndex = 0;

    editor.state.doc.descendants((docNode, pos) => {
      if (docNode.type.name !== "imageBlock") return true;
      const imageAttrs = docNode.attrs as ImageBlockAttrs;
      if (!imageAttrs.src) return false;
      if (typeof currentPos === "number" && pos === currentPos) currentIndex = items.length;
      items.push({
        src: imageAttrs.src,
        alt: imageAttrs.alt || imageAttrs.filename || "image",
      });
      return false;
    });

    setPreviewItems(items.length > 0 ? items : imageSrc ? [{ src: imageSrc, alt: attrs.alt || attrs.filename || "image" }] : []);
    setPreviewIndex(currentIndex);
  }, [attrs.alt, attrs.filename, editor, getPos, imageSrc]);

  const checkSelection = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { from, to } = editor.state.selection;
    setSelected(from <= pos && to >= pos + node.nodeSize);
  }, [editor, getPos, node.nodeSize]);

  useEffect(() => {
    checkSelection();
    editor.on("selectionUpdate", checkSelection);
    editor.on("transaction", checkSelection);
    return () => {
      editor.off("selectionUpdate", checkSelection);
      editor.off("transaction", checkSelection);
    };
  }, [checkSelection, editor]);

  useEffect(() => {
    setLinkDraft(attrs.linkHref || "");
    setAltDraft(attrs.alt || "");
    setCropDraft(attrs.crop || defaultCrop());
  }, [attrs.alt, attrs.crop, attrs.linkHref]);

  useEffect(() => {
    const readWidth = () => {
      const target = frameRef.current?.parentElement || editor.view.dom;
      setFrameWidth(target.getBoundingClientRect().width);
    };

    readWidth();

    const target = frameRef.current?.parentElement || editor.view.dom;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(readWidth);
      observer.observe(target);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", readWidth);
    return () => window.removeEventListener("resize", readWidth);
  }, [editor]);

  const keepToolbar = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setHovered(true);
  };

  const scheduleHide = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setHovered(false);
      hideTimerRef.current = null;
    }, HIDE_DELAY);
  };

  const focusNode = () => {
    const pos = getPos();
    if (typeof pos === "number") {
      editor.chain().focus().setNodeSelection(pos).run();
    }
  };

  const deleteNode = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  const copyNode = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
  };

  const openPreview = () => {
    collectPreviewItems();
    setPreviewOpen(true);
  };

  const handleReplace = async (file: File) => {
    if (!uploadImage) {
      message.error("未选择工作空间");
      return;
    }
    try {
      const image = await uploadImage(file);
      updateAttributes({
        imageId: image.imageId,
        src: image.publicUrl || image.url,
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.size,
        naturalWidth: image.width,
        naturalHeight: image.height,
        width: image.width,
        height: image.height,
        alt: attrs.alt || image.filename,
        crop: null,
        rotate: 0,
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "图片上传失败");
    }
  };

  const handleCropMove = useCallback((event: PointerEvent) => {
    const current = cropDragRef.current;
    if (!current) return;
    const dx = ((event.clientX - current.startX) / current.frameWidth) * 100;
    const dy = ((event.clientY - current.startY) / current.frameHeight) * 100;
    const next = { ...current.crop };

    if (current.corner.includes("w")) {
      next.x = current.crop.x + dx;
      next.width = current.crop.width - dx;
    } else {
      next.width = current.crop.width + dx;
    }

    if (current.corner.includes("n")) {
      next.y = current.crop.y + dy;
      next.height = current.crop.height - dy;
    } else {
      next.height = current.crop.height + dy;
    }

    setCropDraft(clampCrop(next));
  }, []);

  const stopCropDrag = useCallback(() => {
    cropDragRef.current = null;
    window.removeEventListener("pointermove", handleCropMove);
    window.removeEventListener("pointerup", stopCropDrag);
    window.removeEventListener("pointercancel", stopCropDrag);
  }, [handleCropMove]);

  const startCropDrag = (corner: CropCorner) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    focusNode();
    setCropEditing(true);
    const rect = cropFrameRef.current?.getBoundingClientRect();
    cropDragRef.current = {
      corner,
      startX: event.clientX,
      startY: event.clientY,
      frameWidth: rect?.width || 1,
      frameHeight: rect?.height || 1,
      crop: cropDraft,
    };
    window.addEventListener("pointermove", handleCropMove);
    window.addEventListener("pointerup", stopCropDrag, { once: true });
    window.addEventListener("pointercancel", stopCropDrag, { once: true });
  };

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const current = resizeDragRef.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / current.scale;
    const dy = (event.clientY - current.startY) / current.scale;
    const nextWidth = Math.max(
      MIN_IMAGE_WIDTH,
      Math.round(current.startWidth + (current.corner.includes("w") ? -dx : dx)),
    );
    const nextHeight = Math.max(
      MIN_IMAGE_HEIGHT,
      Math.round(current.startHeight + (current.corner.includes("n") ? -dy : dy)),
    );
    const nextDraft = { width: nextWidth, height: nextHeight };
    resizeDraftRef.current = nextDraft;
    setResizeDraft(nextDraft);
  }, []);

  const stopResize = useCallback(() => {
    const current = resizeDraftRef.current;
    if (current) {
      updateAttributes({
        width: current.width,
        height: current.height,
      });
    }
    resizeDragRef.current = null;
    resizeDraftRef.current = null;
    setResizeDraft(null);
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  }, [handleResizeMove, updateAttributes]);

  const startResize = (corner: ResizeCorner) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    focusNode();
    resizeDragRef.current = {
      corner,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: sourceWidth,
      startHeight: sourceHeight,
      scale: Math.max(0.01, displayScale),
    };
    const initialDraft = { width: sourceWidth, height: sourceHeight };
    resizeDraftRef.current = initialDraft;
    setResizeDraft(initialDraft);
    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  };

  const displayWidth = toNumber(attrs.width) || toNumber(attrs.naturalWidth) || undefined;
  const displayHeight = toNumber(attrs.height) || toNumber(attrs.naturalHeight) || undefined;
  const activeCrop = cropEditing ? null : attrs.crop;
  const sourceWidth = resizeDraft?.width || displayWidth || 320;
  const sourceHeight = resizeDraft?.height || displayHeight || 180;
  const visibleWidth = activeCrop ? Math.max(1, Math.round(sourceWidth * activeCrop.width / 100)) : sourceWidth;
  const visibleHeight = activeCrop ? Math.max(1, Math.round(sourceHeight * activeCrop.height / 100)) : sourceHeight;
  const rotate = attrs.rotate || 0;
  const rotatedSideways = rotate === 90 || rotate === 270;
  const layoutWidth = rotatedSideways ? visibleHeight : visibleWidth;
  const layoutHeight = rotatedSideways ? visibleWidth : visibleHeight;
  const displayScale = frameWidth > 0 ? Math.min(1, Math.max(0.01, (frameWidth - 2) / layoutWidth)) : 1;
  const displayPx = (value: number) => `${Math.max(1, Math.round(value * displayScale))}px`;
  const signedDisplayPx = (value: number) => `${Math.round(value * displayScale)}px`;
  const layoutStyle = {
    width: displayPx(layoutWidth),
    height: displayPx(layoutHeight),
  };
  const cropWindowStyle = {
    width: displayPx(cropEditing ? sourceWidth : visibleWidth),
    height: displayPx(cropEditing ? sourceHeight : visibleHeight),
    transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
  };
  const imageStyle = {
    width: displayPx(sourceWidth),
    height: displayPx(sourceHeight),
    left: activeCrop ? signedDisplayPx(-sourceWidth * activeCrop.x / 100) : 0,
    top: activeCrop ? signedDisplayPx(-sourceHeight * activeCrop.y / 100) : 0,
  };
  const cropWindowClassName = [
    "image-crop-window",
    ...(attrs.styles || []).map((style) => `image-crop-window--${style}`),
  ].join(" ");
  const fitImageToFullWidth = () => {
    const parentWidth = frameRef.current?.parentElement?.getBoundingClientRect().width || 0;
    const editorWidth = editor.view.dom.getBoundingClientRect().width || 0;
    const availableWidth = Math.max(MIN_IMAGE_WIDTH, Math.floor((parentWidth || editorWidth || sourceWidth) - 2));
    const fitCrop = cropEditing ? cropDraft : attrs.crop;
    const fitVisibleWidth = fitCrop ? Math.max(1, sourceWidth * fitCrop.width / 100) : sourceWidth;
    const fitVisibleHeight = fitCrop ? Math.max(1, sourceHeight * fitCrop.height / 100) : sourceHeight;
    const currentLayoutWidth = Math.max(1, rotatedSideways ? fitVisibleHeight : fitVisibleWidth);
    const scale = availableWidth / currentLayoutWidth;

    updateAttributes({
      width: Math.max(MIN_IMAGE_WIDTH, Math.round(sourceWidth * scale)),
      height: Math.max(MIN_IMAGE_HEIGHT, Math.round(sourceHeight * scale)),
    });
  };
  const toolbarVisible = hovered || selected;
  const wrapperClassName = [
    "image-block-view",
    `image-block-view--${attrs.align || "left"}`,
    selected ? "is-selected" : "",
    cropEditing ? "is-crop-editing" : "",
  ].filter(Boolean).join(" ");
  const cropOverlayStyle = {
    left: `${cropDraft.x}%`,
    top: `${cropDraft.y}%`,
    width: `${cropDraft.width}%`,
    height: `${cropDraft.height}%`,
  };
  const handleToolbarMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isEditableToolbarTarget(event.target)) {
      event.preventDefault();
    }
  };
  const handleToolbarClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  const handleWrapperClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".image-block-toolbar")) return;
    focusNode();
  };
  const selectionControls = selected && !cropEditing ? (
    <>
      <span className="image-selection-outline" aria-hidden="true" />
      <button className="image-resize-handle image-resize-handle--nw" onPointerDown={startResize("nw")} aria-label="从左上角调整图片大小" />
      <button className="image-resize-handle image-resize-handle--ne" onPointerDown={startResize("ne")} aria-label="从右上角调整图片大小" />
      <button className="image-resize-handle image-resize-handle--sw" onPointerDown={startResize("sw")} aria-label="从左下角调整图片大小" />
      <button className="image-resize-handle image-resize-handle--se" onPointerDown={startResize("se")} aria-label="从右下角调整图片大小" />
    </>
  ) : null;
  const linkHotspot = attrs.linkHref && !cropEditing ? (
    <a
      className="image-link-hotspot"
      href={attrs.linkHref}
      target={attrs.linkTarget || "_self"}
      rel={attrs.linkTarget === "_blank" ? "noopener noreferrer" : undefined}
      aria-label={attrs.alt || attrs.filename || "打开图片链接"}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    />
  ) : null;
  const toolbar = toolbarVisible ? (
        <div
          className="image-block-toolbar"
          onMouseEnter={keepToolbar}
          onMouseLeave={scheduleHide}
          onMouseDown={handleToolbarMouseDown}
          onClick={handleToolbarClick}
        >
          <Tooltip title="替换图片">
            <Button icon={<SwapOutlined />} size="small" onClick={() => fileInputRef.current?.click()} />
          </Tooltip>
          <Tooltip title={cropEditing ? "完成裁剪" : "裁剪"}>
            <Button
              icon={cropEditing ? <CheckOutlined /> : <ScissorOutlined />}
              size="small"
              type={cropEditing ? "primary" : "default"}
              onClick={() => {
                if (cropEditing) {
                  updateAttributes({ crop: clampCrop(cropDraft) });
                  setCropEditing(false);
                } else {
                  setCropDraft(attrs.crop || defaultCrop());
                  setCropEditing(true);
                }
              }}
            />
          </Tooltip>
          {attrs.crop && (
            <Tooltip title="恢复原图">
              <Button
                icon={<UndoOutlined />}
                size="small"
                onClick={() => {
                  setCropEditing(false);
                  setCropDraft(defaultCrop());
                  updateAttributes({ crop: null });
                }}
              />
            </Tooltip>
          )}
          <Popover trigger="click" title="宽高" content={
            <Space>
              <InputNumber min={80} addonBefore="宽" value={displayWidth} onChange={(value) => updateAttributes({ width: value ? Number(value) : null })} />
              <InputNumber min={40} addonBefore="高" value={displayHeight} onChange={(value) => updateAttributes({ height: value ? Number(value) : null })} />
            </Space>
          }>
            <Button size="small">宽高</Button>
          </Popover>
          <Tooltip title="宽度顶满">
            <Button icon={<ColumnWidthOutlined />} size="small" onClick={fitImageToFullWidth} />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            open={styleDropdownOpen}
            onOpenChange={(open, info) => {
              if (info.source !== "menu") setStyleDropdownOpen(open);
            }}
            menu={{
            selectable: true,
            multiple: true,
            selectedKeys: attrs.styles || [],
            items: IMAGE_STYLE_OPTIONS.map((option) => ({ key: option.key, label: option.label })),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              setStyleDropdownOpen(true);
              updateAttributes({ styles: toggleImageStyle(attrs.styles || [], key as ImageStyleOption) });
            },
          }}>
            <Button icon={<FormatPainterOutlined />} size="small">样式</Button>
          </Dropdown>
          <Popover trigger="click" title="链接" content={
            <Space direction="vertical">
              <Input value={linkDraft} placeholder="https://example.com" onChange={(event) => setLinkDraft(event.target.value)} />
              <Select
                value={attrs.linkTarget || "_self"}
                style={{ width: 180 }}
                onChange={(value) => updateAttributes({ linkTarget: value })}
                options={[
                  { label: "当前页面打开", value: "_self" },
                  { label: "新页面打开", value: "_blank" },
                ]}
              />
              <Button type="primary" size="small" onClick={() => updateAttributes({ linkHref: normalizeHref(linkDraft) })}>应用</Button>
            </Space>
          }>
            <Button icon={<LinkOutlined />} size="small" />
          </Popover>
          <Popover trigger="click" title="描述" content={
            <Space.Compact>
              <Input value={altDraft} onChange={(event) => setAltDraft(event.target.value)} />
              <Button type="primary" onClick={() => updateAttributes({ alt: altDraft })}>应用</Button>
            </Space.Compact>
          }>
            <Button size="small">描述</Button>
          </Popover>
          <Dropdown trigger={["click"]} menu={{
            items: [
              { key: "left", label: "左对齐", icon: <AlignLeftOutlined /> },
              { key: "center", label: "居中", icon: <AlignCenterOutlined /> },
              { key: "right", label: "右对齐", icon: <AlignRightOutlined /> },
            ],
            onClick: ({ key }) => updateAttributes({ align: key }),
          }}>
            <Button icon={<AlignCenterOutlined />} size="small" />
          </Dropdown>
          <Tooltip title="旋转 90 度">
            <Button icon={<RotateRightOutlined />} size="small" onClick={() => updateAttributes({ rotate: (((attrs.rotate || 0) + 90) % 360) })} />
          </Tooltip>
          <Tooltip title="查看图片">
            <Button icon={<EyeOutlined />} size="small" onClick={openPreview} />
          </Tooltip>
          <Tooltip title="删除">
            <Button icon={<DeleteOutlined />} size="small" danger onClick={deleteNode} />
          </Tooltip>
          <Dropdown trigger={["click"]} menu={{
            items: [{ key: "copy", label: "复制图片", icon: <CopyOutlined /> }],
            onClick: ({ key }) => {
              if (key === "copy") copyNode();
            },
          }}>
            <Button icon={<MoreOutlined />} size="small" />
          </Dropdown>
        </div>
  ) : null;

  return (
    <NodeViewWrapper
      className={wrapperClassName}
      contentEditable={false}
      onMouseEnter={keepToolbar}
      onMouseLeave={scheduleHide}
      onClick={handleWrapperClick}
      data-drag-handle
    >
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void handleReplace(file);
      }} />
      <figure ref={frameRef} className="image-block-frame" data-align={attrs.align || "left"}>
        <span className="image-layout-box" style={layoutStyle}>
          {toolbar}
          <span ref={cropFrameRef} className={cropWindowClassName} style={cropWindowStyle}>
            <img src={imageSrc} alt={attrs.alt || ""} style={imageStyle} />
            {cropEditing && (
              <span className="image-crop-selection" style={cropOverlayStyle}>
                <button className="image-crop-handle image-crop-handle--nw" onPointerDown={startCropDrag("nw")} aria-label="裁剪左上角" />
                <button className="image-crop-handle image-crop-handle--ne" onPointerDown={startCropDrag("ne")} aria-label="裁剪右上角" />
                <button className="image-crop-handle image-crop-handle--sw" onPointerDown={startCropDrag("sw")} aria-label="裁剪左下角" />
                <button className="image-crop-handle image-crop-handle--se" onPointerDown={startCropDrag("se")} aria-label="裁剪右下角" />
              </span>
            )}
          </span>
          {linkHotspot}
          {selectionControls}
        </span>
      </figure>
      <Image.PreviewGroup
        items={previewItems}
        preview={{
          open: previewOpen,
          current: previewIndex,
          onOpenChange: (open, info) => {
            setPreviewOpen(open);
            setPreviewIndex(info.current);
          },
          onChange: (current) => setPreviewIndex(current),
        }}
      />
      {!attrs.src && (
        <div className="image-block-empty">
          <PictureOutlined />
        </div>
      )}
    </NodeViewWrapper>
  );
}
