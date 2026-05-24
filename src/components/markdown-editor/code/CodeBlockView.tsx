import { useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { Button, Dropdown, Input, Select, Space, Switch } from "antd";
import {
  CaretDownOutlined,
  CopyOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { codeLanguageItems } from "../Toolbar/data";
import {
  codeBlockFontSizeItems,
  codeBlockIndentModeItems,
  codeBlockIndentSizeItems,
  codeBlockThemeItems,
  normalizeCodeBlockAttrs,
  type CodeBlockAttrs,
} from "./codeBlockOptions";

export default function CodeBlockView({
  node,
  selected,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const attrs = normalizeCodeBlockAttrs(node.attrs);
  const lineCount = Math.max(1, (node.textContent || "").split("\n").length);

  const setAttr = <K extends keyof CodeBlockAttrs>(key: K, value: CodeBlockAttrs[K]) => {
    updateAttributes({ [key]: value });
  };

  const copyCode = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(node.textContent || "");
  };

  const keepCodeBlockControlActive = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const style = {
    "--code-font-size": attrs.fontSize === "inherit" ? "inherit" : attrs.fontSize,
    "--code-tab-size": String(attrs.indentSize),
  } as CSSProperties;

  const codeBlockFocused = useSyncExternalStore(
    (notify) => {
      editor.on("selectionUpdate", notify);
      editor.on("transaction", notify);
      editor.on("focus", notify);
      editor.on("blur", notify);
      return () => {
        editor.off("selectionUpdate", notify);
        editor.off("transaction", notify);
        editor.off("focus", notify);
        editor.off("blur", notify);
      };
    },
    () => {
      if (!editor.isFocused) return false;

      try {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return selected;

        const { from, to } = editor.state.selection;
        const start = pos;
        const end = pos + node.nodeSize;
        return from >= start && to <= end;
      } catch {
        return false;
      }
    },
    () => false,
  );

  const morePanel = (
    <div className="code-block-more-panel" contentEditable={false}>
      <div className="code-block-menu-row">
        <span>字号</span>
        <Select
          size="small"
          value={attrs.fontSize}
          options={codeBlockFontSizeItems}
          onChange={(value) => setAttr("fontSize", value)}
        />
      </div>
      <div className="code-block-menu-row">
        <span>缩进模式</span>
        <Select
          size="small"
          value={attrs.indentMode}
          options={codeBlockIndentModeItems}
          onChange={(value) => setAttr("indentMode", value)}
        />
      </div>
      <div className="code-block-menu-row">
        <span>缩进宽度</span>
        <Select
          size="small"
          value={attrs.indentSize}
          options={codeBlockIndentSizeItems}
          onChange={(value) => setAttr("indentSize", value)}
        />
      </div>
      <div className="code-block-menu-row">
        <span>自动换行</span>
        <Switch size="small" checked={attrs.wordWrap} onChange={(checked) => setAttr("wordWrap", checked)} />
      </div>
      <div className="code-block-menu-row">
        <span>显示行号</span>
        <Switch
          size="small"
          checked={attrs.lineNumbers}
          onChange={(checked) => setAttr("lineNumbers", checked)}
        />
      </div>
      <div className="code-block-menu-row">
        <span>自动缩进</span>
        <Switch
          size="small"
          checked={attrs.autoIndent}
          onChange={(checked) => setAttr("autoIndent", checked)}
        />
      </div>
      <div className="code-block-menu-divider" />
      <Button block size="small" onClick={() => setAttr("codeCollapsed", !attrs.codeCollapsed)}>
        {attrs.codeCollapsed ? "展开代码块" : "折叠代码块"}
      </Button>
      <Button block size="small" onClick={() => setAttr("statusBarCollapsed", true)}>
        折叠状态栏
      </Button>
    </div>
  );

  return (
    <NodeViewWrapper
      className={[
        "code-block-view",
        selected ? "is-selected" : "",
        codeBlockFocused ? "is-code-focused" : "",
        attrs.wordWrap ? "is-wrapped" : "",
        attrs.statusBarCollapsed ? "is-status-collapsed" : "",
        attrs.codeCollapsed ? "is-code-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      as="div"
      draggable={false}
      data-language={attrs.language}
      data-code-theme={attrs.codeTheme}
      style={style}
    >
      {!attrs.statusBarCollapsed ? (
        <div className="code-block-status-bar" contentEditable={false}>
          <Space size={4} className="code-block-toolbar-left">
            <Input
              variant="borderless"
              className="code-block-title-input"
              value={attrs.title}
              onChange={(event) => setAttr("title", event.target.value)}
              placeholder="请输入代码块名称"
              aria-label="代码块名称"
            />
          </Space>

          <Space size={8} className="code-block-toolbar-right">
            <Select
              variant="borderless"
              size="small"
              aria-label="代码语言"
              value={attrs.language}
              className="code-block-language-select"
              options={codeLanguageItems}
              onChange={(value) => setAttr("language", value)}
            />
            <Select
              variant="borderless"
              size="small"
              aria-label="代码主题"
              value={attrs.codeTheme}
              className="code-block-theme-select"
              options={codeBlockThemeItems}
              onChange={(value) => setAttr("codeTheme", value)}
            />
            <Button
              type="text"
              size="small"
              className="code-block-icon-button"
              icon={<CopyOutlined />}
              aria-label="复制代码"
              onClick={copyCode}
            />
            <span className="code-block-toolbar-separator" aria-hidden="true" />
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              popupRender={() => morePanel}
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
            >
              <Button
                type="text"
                size="small"
                className="code-block-icon-button"
                icon={<MoreOutlined />}
                aria-label="更多代码块设置"
              />
            </Dropdown>
          </Space>
          <button
            type="button"
            className="code-block-status-collapse-tab"
            aria-label="折叠状态栏"
            onMouseDown={keepCodeBlockControlActive}
            onClick={() => setAttr("statusBarCollapsed", true)}
          >
            <CaretDownOutlined />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="code-block-status-restore-tab"
          contentEditable={false}
          aria-label="展开状态栏"
          onMouseDown={keepCodeBlockControlActive}
          onClick={() => setAttr("statusBarCollapsed", false)}
        >
          <CaretDownOutlined />
        </button>
      )}
      {!attrs.codeCollapsed ? (
        <div className="code-block-body">
          {attrs.lineNumbers ? (
            <div className="code-block-line-numbers" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="code-block-line-number">
                  {i + 1}
                </div>
              ))}
            </div>
          ) : null}
          <div className="code-block-content">
            <NodeViewContent as="div" className="code-block-code" spellCheck={false} />
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
