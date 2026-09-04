import { describe, expect, it } from "vitest";
import {
  buildAiConversationQuery,
  normalizeAiConversationDetail,
  parseAiSseFrames,
} from "./ai-chat";

describe("ai chat service helpers", () => {
  it("builds conversation list query with pagination and workspace filter", () => {
    expect(
      buildAiConversationQuery({
        page: 2,
        pageSize: 10,
        workspaceId: "ws_1",
      }),
    ).toBe("page=2&pageSize=10&workspaceId=ws_1");
  });

  it("normalizes missing message list to empty array", () => {
    expect(
      normalizeAiConversationDetail({
        conversationId: "aic_1",
        title: "测试",
      }),
    ).toEqual({
      conversationId: "aic_1",
      title: "测试",
      messages: [],
    });
  });

  it("parses split SSE delta and done events", () => {
    const events = parseAiSseFrames(
      'event: delta\ndata: {"delta":"hel"}\n\n' +
        'event: delta\ndata: {"delta":"lo"}\n\n' +
        'event: done\ndata: {"conversationId":"aic_1","content":"hello"}\n\n',
    );

    expect(events).toEqual([
      { event: "delta", data: { delta: "hel" } },
      { event: "delta", data: { delta: "lo" } },
      { event: "done", data: { conversationId: "aic_1", content: "hello" } },
    ]);
  });
});
