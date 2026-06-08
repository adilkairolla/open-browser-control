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
import { ChatSession, type ChatMessageView, type PageContext } from "@/lib/chat";
import { BROWSER_AGENT_SYSTEM_PROMPT } from "@/lib/agentPrompt";
import { createBrowserTools } from "@/lib/tools/browserTools";
import { permissionController } from "@/lib/permissions";
import type { IndicatorMessage } from "../../../control/indicator/protocol";
import { openSessionsDb } from "@/lib/sessions/db";
import { SessionManager } from "@/lib/sessions/SessionManager";
import type { Conversation, ConversationSummary } from "@/lib/sessions/types";
import type { UiItem } from "./types";
import type { TranscriptItem } from "@/lib/transcript";

/** Map the rich session transcript to ChatView's item shape (pure, tested). */
export function toUiItems(items: TranscriptItem[], streaming: boolean): UiItem[] {
  // The in-flight reply is the last item when it is assistant text.
  const last = items.length - 1;
  const lastIsStreamingText =
    streaming && last >= 0 && items[last]!.kind === "text" && (items[last] as any).role === "assistant";
  return items.map((it, i) =>
    it.kind === "text"
      ? { kind: "text", id: it.id, role: it.role, text: it.text, streaming: lastIsStreamingText && i === last }
      : {
          kind: "tool",
          id: it.id,
          name: it.name,
          args: it.args,
          status: it.status,
          result: it.result,
          error: it.error,
        },
  );
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

/** Title + URL of the active tab, injected into each turn so the agent stays
 *  oriented. Browser-internal pages it can't act on are reported as no context. */
async function activeTabPageContext(): Promise<PageContext | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) return undefined;
    return { url: tab.url, title: tab.title ?? "" };
  } catch {
    return undefined;
  }
}

/** Show/hide the page glow on the active tab as the agent starts/stops acting.
 *  Best-effort: a tab without the content script (e.g. chrome://) just no-ops. */
async function setActiveTabIndicator(active: boolean): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) return;
    const message: IndicatorMessage = { type: active ? "OBC_SHOW_GLOW" : "OBC_HIDE_GLOW" };
    await chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
  } catch {
    // The glow is cosmetic — never let it disrupt a turn.
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
        systemPrompt: BROWSER_AGENT_SYSTEM_PROMPT,
        initialMessages,
        tools,
        beforeToolCall: permissionController.beforeToolCall,
        getPageContext: activeTabPageContext,
        onAgentActive: setActiveTabIndicator,
      });
    },
    getOrigin: activeTabOrigin,
  });
}

export interface UseSessions {
  conversations: ConversationSummary[];
  activeId?: string;
  messages: UiItem[];
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
  const messages = session ? toUiItems(session.getTranscript(), streaming) : [];

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
