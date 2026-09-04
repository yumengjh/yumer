"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  sendAiChatMessageStream,
  type AiChatMessage,
} from "@/services/ai-chat";
import styles from "./AiChatFloatingPanel.module.css";

interface AiChatFloatingPanelProps {
  open: boolean;
  workspaceId?: string | null;
  onClose: () => void;
}

type PanelMessage = AiChatMessage & {
  id: string;
  streaming?: boolean;
};

function createMessageId(role: AiChatMessage["role"]): string {
  return `${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function AiChatFloatingPanel({
  open,
  workspaceId,
  onClose,
}: AiChatFloatingPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [position.x, position.y]);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const abortCurrentStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSending(false);
  }, []);

  const resetChat = useCallback(() => {
    abortCurrentStream();
    setConversationId(null);
    setMessages([]);
    setPrompt("");
    setError(null);
  }, [abortCurrentStream]);

  const closePanel = useCallback(() => {
    abortCurrentStream();
    onClose();
  }, [abortCurrentStream, onClose]);

  const sendMessage = useCallback(async () => {
    const text = prompt.trim();
    if (!text || sending) return;

    const userMessage: PanelMessage = {
      id: createMessageId("user"),
      role: "user",
      content: text,
    };
    const assistantId = createMessageId("assistant");
    const assistantMessage: PanelMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };
    const abortController = new AbortController();

    abortControllerRef.current = abortController;
    setPrompt("");
    setError(null);
    setSending(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      await sendAiChatMessageStream(
        {
          prompt: text,
          conversationId,
          workspaceId,
        },
        {
          signal: abortController.signal,
          onDelta: (delta) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta, streaming: true }
                  : message,
              ),
            );
          },
          onDone: (result) => {
            setConversationId(result.conversationId);
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: message.content || result.content,
                      streaming: false,
                    }
                  : message,
              ),
            );
          },
        },
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setMessages((current) => current.filter((item) => item.id !== assistantId));
      setError(err instanceof Error ? err.message : "AI 请求失败");
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setSending(false);
    }
  }, [conversationId, prompt, sending, workspaceId]);

  if (!open) return null;

  return (
    <section
      className={styles.panel}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      aria-label="AI 对话窗口"
    >
      <div
        className={styles.header}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className={styles.brand}>
          <div className={styles.avatar}>AI</div>
          <div>
            <h2 className={styles.title}>AI 内容助手</h2>
            <div className={styles.subtitle}>
              真正流式输出，可拖动、可缩放
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.iconButton} type="button" onClick={resetChat}>
            新
          </button>
          <button className={styles.iconButton} type="button" onClick={closePanel}>
            ×
          </button>
        </div>
      </div>

      <div className={styles.messages} ref={messagesRef}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <strong>从一个提示词开始</strong>
            例如：帮我生成一段产品介绍、优化这段文案、列一个文章大纲。
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${styles.bubble} ${
                message.role === "user" ? styles.user : styles.assistant
              }`}
            >
              {message.content}
              {message.streaming && <span className={styles.caret} />}
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        <textarea
          className={styles.input}
          value={prompt}
          placeholder="输入提示词，Enter 换行，Ctrl / ⌘ + Enter 发送"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />
        <div className={styles.footerRow}>
          <span className={styles.hint}>
            {conversationId ? "继续当前会话" : "将创建新会话"}
          </span>
          <button
            className={styles.sendButton}
            type="button"
            disabled={sending || !prompt.trim()}
            onClick={() => void sendMessage()}
          >
            {sending ? "生成中" : "发送"}
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </section>
  );
}
