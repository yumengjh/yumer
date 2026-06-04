import { Input, Button } from "antd";
import { useRef, useEffect } from "react";

interface LinkPickerPopupProps {
  textValue: string;
  linkValue: string;
  onTextChange: (value: string) => void;
  onLinkChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function LinkPickerPopup({
  textValue,
  linkValue,
  onTextChange,
  onLinkChange,
  onConfirm,
  onClose,
}: LinkPickerPopupProps) {
  const linkInputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => linkInputRef.current?.focus(), 50);
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div ref={popupRef} className="link-picker-popup">
      <div className="link-picker-title">链接</div>

      <div className="link-picker-field">
        <label className="link-picker-label">文本</label>
        <Input
          value={textValue}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="显示文字"
        />
      </div>

      <div className="link-picker-field">
        <label className="link-picker-label">链接</label>
        <Input
          ref={linkInputRef as any}
          value={linkValue}
          onChange={(e) => onLinkChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="链接地址"
        />
      </div>

      <div className="link-picker-footer">
        <Button type="primary" onClick={onConfirm} disabled={!linkValue.trim()}>
          确定
        </Button>
      </div>
    </div>
  );
}
