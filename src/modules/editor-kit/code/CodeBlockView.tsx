import {
  Profiler,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ProfilerOnRenderCallback,
} from "react";
import { Button, Dropdown, Input, Select, Space, Switch } from "antd";
import type { InputRef } from "antd/es/input";
import {
  CaretDownOutlined,
  CheckOutlined,
  CopyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { codeLanguageItems } from "../Toolbar/data";
import { countCodeLines } from "./codeBlockLineHtml";
import {
  codeBlockFontSizeItems,
  codeBlockIndentModeItems,
  codeBlockIndentSizeItems,
  normalizeCodeBlockAttrs,
  type CodeBlockAttrs,
} from "./codeBlockOptions";
import { recordEditorPerfSample } from "../perfTrace";

const handleRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  recordEditorPerfSample("MarkdownEditor.NodeView.CodeBlock.render", actualDuration);
};

const languageSelectOptions = codeLanguageItems.map((item) => ({
  value: item.key,
  label: item.label,
}));

export default function CodeBlockView({
  node,
  selected,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const attrs = normalizeCodeBlockAttrs(node.attrs);
  const lineCount = countCodeLines(node.textContent || "");
  const [titleEditing, setTitleEditing] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const titleInputRef = useRef<InputRef>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAttr = <K extends keyof CodeBlockAttrs>(key: K, value: CodeBlockAttrs[K]) => {
    updateAttributes({ [key]: value });
  };

  const copyCode = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(node.textContent || "").then(() => {
      setCodeCopied(true);
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        setCodeCopied(false);
        copyResetTimerRef.current = null;
      }, 2000);
    });
  };

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const keepCodeBlockControlActive = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const toggleStatusBar = () => {
    setAttr("statusBarCollapsed", !attrs.statusBarCollapsed);
  };

  const beginTitleEdit = (event: MouseEvent<HTMLElement>) => {
    keepCodeBlockControlActive(event);
    setTitleEditing(true);
  };

  const finishTitleEdit = () => {
    const trimmed = attrs.title.trim();
    if (trimmed !== attrs.title) {
      setAttr("title", trimmed);
    }
    setTitleEditing(false);
  };

  const handleTitleInputMouseDown = (event: MouseEvent<HTMLElement>) => {
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

  useEffect(() => {
    if (!titleEditing) return;
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus({ preventScroll: true });
      titleInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [titleEditing]);

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
      <Button block size="small" onClick={() => setAttr("statusBarCollapsed", !attrs.statusBarCollapsed)}>
        {attrs.statusBarCollapsed ? "展开状态栏" : "折叠状态栏"}
      </Button>
    </div>
  );

  return (
    <Profiler id="CodeBlock" onRender={handleRender}>
      <NodeViewWrapper
      className={[
        "code-block-view",
        selected ? "is-selected" : "",
        codeBlockFocused ? "is-code-focused" : "",
        attrs.wordWrap ? "is-wrapped" : "",
        attrs.statusBarCollapsed ? "is-status-collapsed" : "",
        attrs.codeCollapsed ? "is-code-collapsed" : "",
        attrs.lineNumbers ? "has-line-numbers" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      as="div"
      draggable={false}
      data-language={attrs.language}
      data-code-theme={attrs.codeTheme}
      style={style}
    >
      <div className="code-block-status-shell" contentEditable={false}>
        <div className="code-block-status-bar">
          <div className="code-block-toolbar-left">
            <Button
              type="text"
              size="small"
              className="code-block-icon-button code-block-fold-button"
              icon={attrs.codeCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              aria-label={attrs.codeCollapsed ? "展开代码块" : "折叠代码块"}
              aria-pressed={attrs.codeCollapsed}
              onMouseDown={keepCodeBlockControlActive}
              onClick={() => setAttr("codeCollapsed", !attrs.codeCollapsed)}
            />
            {titleEditing ? (
              <Input
                ref={titleInputRef}
                variant="borderless"
                className="code-block-title-input"
                value={attrs.title}
                onChange={(event) => setAttr("title", event.target.value)}
                onMouseDown={handleTitleInputMouseDown}
                onBlur={finishTitleEdit}
                onPressEnter={finishTitleEdit}
                placeholder="请输入代码块名称"
                aria-label="代码块名称"
              />
            ) : (
              <button
                type="button"
                className={[
                  "code-block-title-display",
                  attrs.title ? "has-title" : "is-placeholder",
                ].join(" ")}
                onMouseDown={beginTitleEdit}
                aria-label="编辑代码块名称"
              >
                {attrs.title || "请输入代码块名称"}
              </button>
            )}
          </div>

          <Space size={8} className="code-block-toolbar-right">
            <Select
              variant="borderless"
              size="small"
              showSearch
              aria-label="代码语言"
              value={attrs.language}
              className="code-block-language-select"
              classNames={{ popup: { root: "code-block-language-dropdown" } }}
              options={languageSelectOptions}
              optionFilterProp="label"
              popupMatchSelectWidth
              getPopupContainer={() => document.body}
              onChange={(value) => setAttr("language", value)}
            />
            <Button
              type="text"
              size="small"
              className={["code-block-icon-button", codeCopied ? "is-copied" : ""]
                .filter(Boolean)
                .join(" ")}
              icon={codeCopied ? <CheckOutlined /> : <CopyOutlined />}
              aria-label={codeCopied ? "已复制" : "复制代码"}
              onMouseDown={keepCodeBlockControlActive}
              onClick={copyCode}
            />
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              align={{ offset: [0, 4] }}
              classNames={{ root: "code-block-more-dropdown" }}
              popupRender={() => morePanel}
              getPopupContainer={() => document.body}
            >
              <Button
                type="text"
                size="small"
                className="code-block-icon-button"
                icon={<MoreOutlined />}
                aria-label="更多代码块设置"
                onMouseDown={keepCodeBlockControlActive}
              />
            </Dropdown>
          </Space>
        </div>

        <button
          type="button"
          className="code-block-status-collapse-tab code-block-status-restore-tab"
          aria-label={attrs.statusBarCollapsed ? "展开状态栏" : "折叠状态栏"}
          aria-expanded={!attrs.statusBarCollapsed}
          onMouseDown={keepCodeBlockControlActive}
          onClick={toggleStatusBar}
        >
          <CaretDownOutlined className="code-block-status-collapse-icon" />
        </button>
      </div>

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
    </Profiler>
  );
}
