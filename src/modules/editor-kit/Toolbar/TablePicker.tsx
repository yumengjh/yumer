import { useState, useCallback } from "react";
import "./TablePicker.css";

const MIN_GRID = 3;
const MAX_GRID = 10;

interface TablePickerProps {
  onSelect: (rows: number, cols: number) => void;
}

export default function TablePicker({ onSelect }: TablePickerProps) {
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const [gridRows, setGridRows] = useState(MIN_GRID);
  const [gridCols, setGridCols] = useState(MIN_GRID);

  const handleCellHover = useCallback(
    (r: number, c: number) => {
      setHoverRow(r);
      setHoverCol(c);

      let newRows = gridRows;
      let newCols = gridCols;

      if (r >= gridRows - 1 && gridRows < MAX_GRID) {
        newRows = Math.min(r + 2, MAX_GRID);
      }
      if (c >= gridCols - 1 && gridCols < MAX_GRID) {
        newCols = Math.min(c + 2, MAX_GRID);
      }

      if (newRows !== gridRows) setGridRows(newRows);
      if (newCols !== gridCols) setGridCols(newCols);
    },
    [gridRows, gridCols],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverRow(-1);
    setHoverCol(-1);
    setGridRows(MIN_GRID);
    setGridCols(MIN_GRID);
  }, []);

  const handleClick = useCallback(() => {
    if (hoverRow < 0 || hoverCol < 0) return;
    onSelect(hoverRow + 1, hoverCol + 1);
  }, [hoverRow, hoverCol, onSelect]);

  const rows = hoverRow >= 0 ? hoverRow + 1 : 0;
  const cols = hoverCol >= 0 ? hoverCol + 1 : 0;

  return (
    <div className="table-picker" onMouseLeave={handleMouseLeave} onClick={handleClick}>
      <div
        className="table-picker-grid"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${gridRows}, 1fr)`,
        }}
      >
        {Array.from({ length: gridRows }, (_, r) =>
          Array.from({ length: gridCols }, (_, c) => {
            const highlighted = r <= hoverRow && c <= hoverCol;
            return (
              <div
                key={`${r}-${c}`}
                className={`table-picker-cell${highlighted ? " highlighted" : ""}`}
                onMouseEnter={() => handleCellHover(r, c)}
              />
            );
          }),
        )}
      </div>
      <div className="table-picker-label">
        {rows > 0 && cols > 0 ? `${cols}×${rows} 表格` : "选择表格大小"}
      </div>
    </div>
  );
}
