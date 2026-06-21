import { useEffect, useRef, useState } from "react";
import { Input, Button, Switch, Tooltip } from "antd";
import {
  SearchOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  SwapOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import type { Editor } from "@tiptap/react";
import { useFindReplace } from "./useFindReplace";
import { useDraggable } from "./useDraggable";
import "./FindReplaceBar.css";

interface FindReplaceBarProps {
  editor: Editor | null;
  visible: boolean;
  onClose: () => void;
}

export default function FindReplaceBar({
  editor,
  visible,
  onClose,
}: FindReplaceBarProps) {
  const {
    query,
    setQuery,
    replaceText,
    setReplaceText,
    caseSensitive,
    setCaseSensitive,
    matchCount,
    currentIndex,
    matches,
    goToNext,
    goToPrev,
    goToIndex,
    replaceCurrent,
    replaceAll,
    reset: resetSearch,
  } = useFindReplace({ editor, active: visible });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── 拖拽：整个面板为拖拽区，交互元素自动排除 ──
  const { position, reset: resetDrag } = useDraggable({
    panelRef,
    enabled: visible,
  });

  // ── 动画 ──
  const [mounted, setMounted] = useState(false);
  const [animClass, setAnimClass] = useState("");
  const prevVisibleRef = useRef(false);

  useEffect(() => {
    const prev = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (visible && !prev) {
      setMounted(true);
      setAnimClass("find-replace-bar--enter");
    } else if (!visible && prev) {
      setAnimClass("find-replace-bar--exit");
      const timer = setTimeout(() => {
        setMounted(false);
        setAnimClass("");
        resetSearch();
        resetDrag();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [visible, resetSearch, resetDrag]);

  // 打开时聚焦
  useEffect(() => {
    if (mounted && visible) {
      const t = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [mounted, visible]);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible, onClose]);

  // 键盘
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        if (document.activeElement === searchInputRef.current) {
          e.preventDefault();
          goToNext();
        }
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        goToPrev();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, onClose, goToNext, goToPrev]);

  if (!mounted) return null;

  const counterText =
    matchCount > 0 ? `${currentIndex + 1} / ${matchCount}` : "无匹配";

  const posStyle: React.CSSProperties | undefined =
    position != null
      ? { left: position.x, top: position.y, right: "auto" }
      : undefined;

  return (
    <div
      className={`find-replace-bar ${animClass}`}
      ref={panelRef}
      style={posStyle}
    >
      <div className="find-replace-bar__content">
        {/* 搜索行 */}
        <div className="find-replace-bar__row">
          <Input
            ref={searchInputRef as never}
            size="small"
            placeholder="搜索内容"
            prefix={<SearchOutlined className="find-replace-bar__icon" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="find-replace-bar__input"
            suffix={
              <span className="find-replace-bar__counter">{counterText}</span>
            }
            allowClear
          />
          <div className="find-replace-bar__nav">
            <Tooltip title="上一个 (Shift+Enter)">
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                onClick={goToPrev}
                disabled={matchCount === 0}
              />
            </Tooltip>
            <Tooltip title="下一个 (Enter)">
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                onClick={goToNext}
                disabled={matchCount === 0}
              />
            </Tooltip>
          </div>

          <Tooltip title="区分大小写">
            <span className="find-replace-bar__option">
              <Switch
                size="small"
                checked={caseSensitive}
                onChange={(v) => setCaseSensitive(v)}
              />
              <span className="find-replace-bar__option-label">Aa</span>
            </span>
          </Tooltip>

          <Tooltip title="关闭 (Esc)">
            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
            />
          </Tooltip>
        </div>

        {/* 替换行 */}
        <div className="find-replace-bar__row">
          <Input
            size="small"
            placeholder="替换为"
            prefix={<SwapOutlined className="find-replace-bar__icon" />}
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            className="find-replace-bar__input"
            allowClear
          />
          <div className="find-replace-bar__actions">
            <Tooltip title="替换当前">
              <Button
                size="small"
                onClick={replaceCurrent}
                disabled={matchCount === 0 || currentIndex < 0}
              >
                替换
              </Button>
            </Tooltip>
            <Tooltip title="全部替换">
              <Button
                size="small"
                onClick={replaceAll}
                disabled={matchCount === 0}
              >
                全部替换
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 匹配列表 */}
      {matchCount > 0 && (
        <div className="find-replace-bar__list">
          {matches.map((m, i) => (
            <div
              key={`${m.from}-${m.to}`}
              className={`find-replace-bar__list-item ${i === currentIndex ? "find-replace-bar__list-item--active" : ""}`}
              onClick={() => goToIndex(i)}
            >
              <span className="find-replace-bar__list-type">
                {m.blockLabel}
              </span>
              <span className="find-replace-bar__list-text">{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
