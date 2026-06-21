import { Profiler, type CSSProperties, type ProfilerOnRenderCallback } from "react";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { getListTypographyVars } from "./extensions/listTypography";
import { recordEditorPerfSample } from "./perfTrace";

const handleRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  recordEditorPerfSample("MarkdownEditor.NodeView.TaskItem.render", actualDuration);
};

export default function TaskItemView({ node, updateAttributes }: NodeViewProps) {
  const typographyVars = getListTypographyVars(node);
  const styleVars = typographyVars
    ? (typographyVars as CSSProperties)
    : undefined;
  const inputId = `task-item-${node.attrs.clientId ?? node.attrs.blockId ?? "local"}`;

  return (
    <Profiler id="TaskItem" onRender={handleRender}>
      <NodeViewWrapper
      as="li"
      className="task-list-item"
      data-list-font-size={typographyVars?.["--list-font-size"]}
      style={styleVars}
    >
      <div className="checkbox-wrapper" contentEditable={false}>
        <input
          id={inputId}
          type="checkbox"
          className="check task-item-checkbox-input"
          checked={node.attrs.checked}
          onChange={(e) => updateAttributes({ checked: e.target.checked })}
        />
        <label htmlFor={inputId} className="label task-item-checkbox">
          <svg
            className="task-item-checkbox-svg"
            viewBox="0 0 95 95"
            aria-hidden="true"
          >
            <rect x="30" y="20" width="50" height="50" fill="none" className="task-item-checkbox-box" />
            <g transform="translate(0,-952.36222)">
              <path
                d="m 56,963 c -102,122 6,9 7,9 17,-5 -66,69 -38,52 122,-77 -7,14 18,4 29,-11 45,-43 23,-4"
                fill="none"
                className="path1 task-item-check-path"
              />
            </g>
          </svg>
        </label>
      </div>
      <NodeViewContent as="div" className="task-item-content" />
      </NodeViewWrapper>
    </Profiler>
  );
}
