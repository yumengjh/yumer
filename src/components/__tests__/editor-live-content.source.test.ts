import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("EditorPage live content flow", () => {
  it("keeps frequent editor changes out of the heavy content state", () => {
    const source = readFileSync("src/components/EditorPage.tsx", "utf8");

    expect(source).toContain("const [liveContent, setLiveContent] = useState<EditorContent>(BLANK_CONTENT);");
    expect(source).toContain("setLiveContent(nextContent);");
    expect(source).toContain("const markdownEditorStyle = useMemo<CSSProperties>");
    expect(source).toContain("style={markdownEditorStyle}");
    expect(source).toContain("const markdownEditorElement = useMemo(() => (");
    expect(source).toContain("{markdownEditorElement}");

    const handleEditorChangeAt = source.indexOf("const handleEditorChange = useCallback");
    const handleTitleChangeAt = source.indexOf("const handleTitleChange = useCallback", handleEditorChangeAt);
    const handleEditorChangeBody = source.slice(handleEditorChangeAt, handleTitleChangeAt);

    expect(handleEditorChangeAt).toBeGreaterThanOrEqual(0);
    expect(handleTitleChangeAt).toBeGreaterThan(handleEditorChangeAt);
    expect(handleEditorChangeBody).not.toContain("setContent(nextContent)");
  });
});
