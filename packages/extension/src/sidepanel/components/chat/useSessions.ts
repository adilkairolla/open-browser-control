/**
 * React adapter over SessionManager. Owns one manager instance for the app's
 * lifetime, re-renders on every manager/session change, and exposes the data +
 * handlers that App feeds into ChatView and ConversationsDrawer. All real logic
 * lives in SessionManager (unit-tested); this is a thin, mostly-untestable shell.
 */
import { useEffect, useRef, useState } from "react";
import type { KnownProvider } from "@earendil-works/pi-ai";
import { authStore } from "@/lib/authStore";
import { listModels } from "@/lib/providers";
import { ChatSession, type ChatMessageView } from "@/lib/chat";
import { createBrowserTools } from "@/lib/tools/browserTools";
import { permissionController } from "@/lib/permissions";
import { openSessionsDb } from "@/lib/sessions/db";
import { SessionManager } from "@/lib/sessions/SessionManager";
import type { Conversation, ConversationSummary } from "@/lib/sessions/types";
import type { UiMessage } from "./types";

/** Map the session transcript to ChatView's message shape (pure, tested). */
export function toUiMessages(messages: ChatMessageView[], streaming: boolean): UiMessage[] {
  return messages.map((m, i) => ({
    id: String(i),
    role: m.role,
    text: m.text,
    streaming: streaming && m.role === "assistant" && i === messages.length - 1,
  }));
}

/** Hostname of the active tab, used to tag where a conversation started. */
async function activeTabOrigin(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return undefined;
    return new URL(tab.url).hostname;
  } catch {
    return undefined;
  }
}

function createManager(): SessionManager {
  const { conversations, messages } = openSessionsDb();
  const tools = createBrowserTools();
  return new SessionManager({
    conversations,
    messages,
    createSession: ({ providerSlug, modelId, initialMessages }) => {
      const models = listModels(providerSlug as KnownProvider);
      const model = models.find((x) => x.id === modelId) ?? models[0];
      if (!model) throw new Error(`No models available for provider "${providerSlug}"`);
      return new ChatSession({
        model,
        getToken: (p) => authStore.getToken(p),
        initialMessages,
        tools,
        beforeToolCall: permissionController.beforeToolCall,
      });
    },
    getOrigin: activeTabOrigin,
  });
}

export interface UseSessions {
  conversations: ConversationSummary[];
  activeId?: string;
  messages: UiMessage[];
  streaming: boolean;
  error?: string;
  send: (text: string) => void;
  stop: () => void;
  newChat: (provider: string, model: string) => void;
  open: (id: string) => Promise<Conversation | undefined>;
  remove: (id: string) => void;
  setModel: (provider: string, model: string) => void;
  activeTool?: string;
}

export function useSessions(): UseSessions {
  const [, force] = useState(0);
  const ref = useRef<SessionManager | null>(null);
  const mgr = (ref.current ??= createManager());

  useEffect(() => {
    const unsub = mgr.subscribe(() => force((n) => n + 1));
    void mgr.init();
    return unsub;
  }, [mgr]);

  const session = mgr.activeSession();
  const streaming = session?.isStreaming() ?? false;
  const messages = session ? toUiMessages(session.getMessages(), streaming) : [];

  return {
    conversations: mgr.list(),
    activeId: mgr.activeId(),
    messages,
    streaming,
    error: session?.error(),
    send: (text) => void mgr.send(text),
    stop: () => mgr.stop(),
    newChat: (provider, model) => mgr.startNew(provider, model),
    open: (id) => mgr.open(id),
    remove: (id) => void mgr.deleteConversation(id),
    setModel: (provider, model) => mgr.setModel(provider, model),
    activeTool: session?.activeTool(),
  };
}
