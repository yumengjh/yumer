import { describe, expect, it } from "vitest";
import {
  buildSearchQueryString,
  normalizeSearchResponse,
  type SearchParams,
} from "./search";

describe("search service", () => {
  it("builds query string with workspace and pagination parameters", () => {
    const query = buildSearchQueryString({
      query: "alpha beta",
      workspaceId: "ws_123",
      page: 3,
      pageSize: 10,
      type: "all",
    });

    expect(query).toBe(
      "query=alpha+beta&workspaceId=ws_123&page=3&pageSize=10&type=all",
    );
  });

  it("omits optional parameters when not provided", () => {
    const params: SearchParams = {
      query: "roadmap",
    };

    expect(buildSearchQueryString(params)).toBe("query=roadmap");
  });

  it("normalizes missing items to an empty list", () => {
    expect(
      normalizeSearchResponse({
        total: 0,
        page: 1,
        pageSize: 10,
      }),
    ).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
  });

  it("normalizes the current backend search response shape", () => {
    expect(
      normalizeSearchResponse({
        documents: {
          items: [
            {
              docId: "doc_1",
              workspaceId: "ws_1",
              title: "TypeORM,实体类和GraphQL的关系",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        },
        blocks: {
          items: [
            {
              blockId: "block_1",
              docId: "doc_2",
              docTitle: "最最最劲爆哦",
              plainText: "欢迎使用 Markdown 增强型富文本编辑器",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        },
      }),
    ).toEqual({
      items: [
        {
          type: "document",
          docId: "doc_1",
          workspaceId: "ws_1",
          title: "TypeORM,实体类和GraphQL的关系",
          icon: undefined,
          rank: undefined,
        },
        {
          type: "block",
          blockId: "block_1",
          docId: "doc_2",
          docTitle: "最最最劲爆哦",
          content: "欢迎使用 Markdown 增强型富文本编辑器",
          rank: undefined,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    });
  });
});
