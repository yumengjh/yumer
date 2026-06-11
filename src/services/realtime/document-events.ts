import { apiFetch } from "@/services/api-client";
import type { RealtimeSseEvent } from "./types";

type SubscribeDocumentEventsArgs = {
  docId: string;
  onEvent: (event: RealtimeSseEvent) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
};

type ParsedSseMessage = {
  id: string | null;
  event: string | null;
  data: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseSseMessage(raw: string): ParsedSseMessage | null {
  const lines = raw.split(/\r?\n/);
  let id: string | null = null;
  let event: string | null = null;
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trimStart();
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) return null;
  return { id, event, data: data.join("\n") };
}

function emitParsedMessage(
  raw: string,
  onEvent: (event: RealtimeSseEvent) => void,
): void {
  const message = parseSseMessage(raw);
  if (!message) return;
  const parsed = JSON.parse(message.data) as RealtimeSseEvent;
  onEvent(parsed);
}

export function subscribeDocumentEvents({
  docId,
  onEvent,
  onOpen,
  onError,
}: SubscribeDocumentEventsArgs): { close: () => void } {
  const controller = new AbortController();
  let closed = false;

  const run = async () => {
    let backoffMs = 1000;
    while (!closed) {
      try {
        const response = await apiFetch(`/realtime/documents/${docId}/events`, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Realtime stream failed with ${response.status}`);
        }
        onOpen?.();
        backoffMs = 1000;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            emitParsedMessage(chunk, onEvent);
          }
        }
      } catch (error) {
        if (!closed) onError?.(error);
      }

      if (!closed) {
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 10_000);
      }
    }
  };

  void run();

  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
}
