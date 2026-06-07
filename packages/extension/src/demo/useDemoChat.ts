/**
 * Drives the playground with mock state: fake streaming, provider/model
 * switching, new chat. Produces the exact ChatViewProps the real app will later
 * build from a ChatSession, so the layouts can't tell the difference.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatViewProps, UiMessage } from "@/components/chat/types";
import { cannedReplies, modelsByProvider, providers, suggestions } from "./mock";

let counter = 0;
const nextId = () => `demo-${++counter}`;

export function useDemoChat(initial: UiMessage[]): ChatViewProps {
  const firstProvider = providers[0]!.slug;
  const [provider, setProvider] = useState(firstProvider);
  const [model, setModel] = useState(modelsByProvider[firstProvider]![0]!.id);
  const [messages, setMessages] = useState<UiMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyIdx = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setStreaming(false);
    setMessages((ms) => ms.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  const send = useCallback((text: string) => {
    if (timer.current) return; // already streaming
    const userMsg: UiMessage = { id: nextId(), role: "user", text };
    const full = cannedReplies[replyIdx.current % cannedReplies.length]!;
    replyIdx.current += 1;
    const assistantId = nextId();
    setMessages((ms) => [...ms, userMsg, { id: assistantId, role: "assistant", text: "", streaming: true }]);
    setStreaming(true);

    let i = 0;
    timer.current = setInterval(() => {
      i += 3;
      const slice = full.slice(0, i);
      setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, text: slice } : m)));
      if (i >= full.length) {
        if (timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        setStreaming(false);
        setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
      }
    }, 16);
  }, []);

  const selectProvider = useCallback((slug: string) => {
    setProvider(slug);
    setModel(modelsByProvider[slug]?.[0]?.id ?? "");
  }, []);

  const newChat = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  return {
    providers,
    models: modelsByProvider[provider] ?? [],
    provider,
    model,
    messages,
    streaming,
    suggestions,
    onSelectProvider: selectProvider,
    onSelectModel: setModel,
    onSend: send,
    onStop: stop,
    onNewChat: newChat,
    onManageProviders: () => {},
  };
}
