import { textColorPalette, bgColorPalette } from "./data";
import { CloseOutlined } from "@ant-design/icons";

interface ColorPickerPanelProps {
  selectedTextColor: string;
  selectedBgColor: string;
  onTextColorSelect: (color: string) => void;
  onBgColorSelect: (color: string) => void;
}

export default function ColorPickerPanel({
  selectedTextColor,
  selectedBgColor,
  onTextColorSelect,
  onBgColorSelect,
}: ColorPickerPanelProps) {
  return (
    <div className="combined-color-panel">
      {/* 字体颜色 */}
      <div className="combined-color-section">
        <div className="combined-color-title">字体颜色</div>
        <div className="combined-color-grid">
          {textColorPalette.map((row, ri) => (
            <div key={ri} className="combined-color-row">
              {row.map((color) => {
                const isActive = selectedTextColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    className={`text-color-swatch${isActive ? " is-active" : ""}`}
                    onClick={() => onTextColorSelect(color)}
                    title={color}
                  >
                    <span className="text-color-letter" style={{ color }}>
                      A
                    </span>
                    {isActive && <span className="swatch-check">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="combined-color-divider" />

      {/* 字体背景色 */}
      <div className="combined-color-section">
        <div className="combined-color-title">字体背景色</div>
        <div className="combined-color-grid">
          {bgColorPalette.map((row, ri) => (
            <div key={ri} className="combined-color-row">
              {row.map((color, ci) => {
                const isClear = color === "";
                const isActive = !isClear && selectedBgColor === color;
                return (
                  <button
                    key={isClear ? "clear" : color}
                    type="button"
                    className={`bg-color-swatch${isActive ? " is-active" : ""}${isClear ? " is-clear" : ""}`}
                    style={isClear ? undefined : { backgroundColor: color }}
                    onClick={() => onBgColorSelect(color)}
                    title={isClear ? "无背景色" : color}
                  >
                    {isClear && <CloseOutlined className="bg-clear-icon" />}
                    {isActive && <span className="swatch-check">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
