import { describe, expect, it } from "vitest";
import { shouldScheduleFindReplaceRefresh } from "./useFindReplace";

describe("shouldScheduleFindReplaceRefresh", () => {
  it("requires both an active panel and a non-empty query", () => {
    expect(shouldScheduleFindReplaceRefresh(false, "word")).toBe(false);
    expect(shouldScheduleFindReplaceRefresh(true, "")).toBe(false);
    expect(shouldScheduleFindReplaceRefresh(true, "word")).toBe(true);
  });
});
