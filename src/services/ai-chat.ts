import { apiFetch, apiGet, apiPost } from "./api-client";

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiChatResponse {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  model: string;
}

export interface AiConversation {
  conversationId: string;
  userId?: string;
  workspaceId?: string | null;
  title: string;
  status?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiConversationDetail extends AiConversation {
  messages: AiChatMessage[];
}

export interface AiConversationListParams {
  page?: number;
  pageSize?: number;
  workspaceId?: string | null;
}

export interface AiConversationList {
  items: AiConversation[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AiSseEvent {
  event: string;
  data: unknown;
}

export interface AiChatStreamHandlers {
  onDelta: (delta: string) => void;
  onDone?: (result: AiChatResponse) => void;
  signal?: AbortSignal;
}

export function buildAiConversationQuery(params: AiConversationListParams): string {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.workspaceId) query.set("workspaceId", params.workspaceId);
  return query.toString();
}

export function parseAiSseFrames(text: string): AiSseEvent[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      const event = eventLine?.slice("event:".length).trim() || "message";
      const dataText = dataLines
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      return {
        event,
        data: dataText ? JSON.parse(dataText) : null,
      };
    });
}

export function normalizeAiConversationDetail(
  detail: Partial<AiConversationDetail> & Pick<AiConversationDetail, "conversationId" | "title">,
): AiConversationDetail {
  return {
    ...detail,
    messages: Array.isArray(detail.messages) ? detail.messages : [],
  };
}

export async function sendAiChatMessage(input: {
  prompt: string;
  conversationId?: string | null;
  workspaceId?: string | null;
}): Promise<AiChatResponse> {
  return apiPost<AiChatResponse>("/ai/chat", {
    prompt: input.prompt,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
}

export async function sendAiChatMessageStream(
  input: {
    prompt: string;
    conversationId?: string | null;
    workspaceId?: string | null;
  },
  handlers: AiChatStreamHandlers,
): Promise<AiChatResponse> {
  const response = await apiFetch("/ai/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      prompt: input.prompt,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    }),
    signal: handlers.signal,
  });

  if (!response.ok) {
    throw new Error((await response.text()) || "AI 流式请求失败");
  }
  if (!response.body) {
    throw new Error("当前浏览器不支持流式响应");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneResult: AiChatResponse | null = null;

  const consumeFrameText = (text: string) => {
    for (const item of parseAiSseFrames(text)) {
      if (item.event === "delta") {
        const delta = readStringField(item.data, "delta");
        if (delta) handlers.onDelta(delta);
        continue;
      }
      if (item.event === "done") {
        doneResult = item.data as AiChatResponse;
        handlers.onDone?.(doneResult);
        continue;
      }
      if (item.event === "error") {
        throw new Error(readStringField(item.data, "message") || "AI 流式生成失败");
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    consumeFrameText(parts.join("\n\n"));
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeFrameText(buffer);
  }

  if (!doneResult) {
    throw new Error("AI 流式响应异常结束");
  }
  return doneResult;
}

function readStringField(value: unknown, field: string): string {
  if (!value || typeof value !== "object" || !(field in value)) return "";
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : "";
}

export async function listAiConversations(
  params: AiConversationListParams = {},
): Promise<AiConversationList> {
  const query = buildAiConversationQuery(params);
  return apiGet<AiConversationList>(`/ai/conversations${query ? `?${query}` : ""}`);
}

export async function getAiConversation(
  conversationId: string,
): Promise<AiConversationDetail> {
  const detail = await apiGet<AiConversationDetail>(
    `/ai/conversations/${conversationId}`,
  );
  return normalizeAiConversationDetail(detail);
}
