import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn, AgentMessage, AgentTool, AgentOptions } from "@earendil-works/pi-agent-core";
import type { Model, Api, AssistantMessage, UserMessage, Usage } from "@earendil-works/pi-ai";
import { buildTranscript, type TranscriptItem } from "./transcript";

export type ChatRole = "user" | "assistant";

export interface ChatMessageView {
  role: ChatRole;
  text: string;
}

/** The active tab the agent is operating on, injected into each turn. */
export interface PageContext {
  url: string;
  title: string;
}

export interface ChatSessionOptions {
  model: Model<Api>;
  getToken: (provider: string) => Promise<string | undefined> | string | undefined;
  systemPrompt?: string;
  /** Prior turns to seed the agent with (for reopening a stored conversation). */
  initialMessages?: ChatMessageView[];
  /** Rich display transcript (text + tool items) to seed the UI on reopen. */
  initialTranscript?: TranscriptItem[];
  /** Test-only override of the LLM call. Production omits it (uses pi's default). */
  streamFn?: StreamFn;
  /** Browser-control (or other) tools to register with the agent. */
  tools?: AgentTool<any>[];
  /** Permission gate fired before each tool runs. */
  beforeToolCall?: AgentOptions["beforeToolCall"];
  /** Resolves the active tab so each turn can be oriented to the current page. */
  getPageContext?: () => Promise<PageContext | undefined> | PageContext | undefined;
  /** Fired true when the first tool of a turn runs, false when the turn ends —
   *  drives the page glow. Never fires for pure-text turns. */
  onAgentActive?: (active: boolean) => void;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>\s*/g;

/** The per-turn orientation block prepended to the user message (kept out of the UI). */
export function formatTabReminder(ctx: PageContext): string {
  return `<system-reminder>Active tab — title: ${JSON.stringify(ctx.title)}, url: ${ctx.url}</system-reminder>`;
}

/** Strip injected system-reminder blocks so they never render in the transcript. */
export function stripReminders(text: string): string {
  return text.replace(REMINDER_RE, "").trimStart();
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Build a pi AgentMessage from a stored view. Assistant messages need the
 *  model's api/provider/id and a usage stub; only the text is meaningful. */
function toAgentMessage(view: ChatMessageView, model: Model<Api>): AgentMessage {
  if (view.role === "user") {
    return { role: "user", content: view.text, timestamp: 0 } satisfies UserMessage;
  }
  return {
    role: "assistant",
    content: [{ type: "text", text: view.text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp: 0,
  } satisfies AssistantMessage;
}

/** Minimal surface the session manager and views depend on. */
export interface ChatSessionLike {
  send(text: string): Promise<void>;
  abort(): void;
  getMessages(): ChatMessageView[];
  getTranscript(): TranscriptItem[];
  isStreaming(): boolean;
  error(): string | undefined;
  activeTool(): string | undefined;
  subscribe(listener: () => void): () => void;
}

/** Join the text parts of an LLM message into a plain string. */
function messageText(content: AssistantMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class ChatSession implements ChatSessionLike {
  private readonly agent: Agent;
  private readonly listeners = new Set<() => void>();
  private activeToolName: string | undefined;
  private turnActive = false;
  private readonly getPageContext?: ChatSessionOptions["getPageContext"];
  private readonly onAgentActive?: ChatSessionOptions["onAgentActive"];
  private readonly seededTranscript: TranscriptItem[];
  private readonly seedCount: number;

  constructor(options: ChatSessionOptions) {
    this.getPageContext = options.getPageContext;
    this.onAgentActive = options.onAgentActive;
    this.seededTranscript = options.initialTranscript ?? [];
    this.seedCount = (options.initialMessages ?? []).length;
    this.agent = new Agent({
      initialState: {
        model: options.model,
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        thinkingLevel: "off",
        tools: options.tools ?? [],
        messages: (options.initialMessages ?? []).map((m) => toAgentMessage(m, options.model)),
      },
      getApiKey: (provider) => options.getToken(provider),
      ...(options.streamFn ? { streamFn: options.streamFn } : {}),
      ...(options.beforeToolCall ? { beforeToolCall: options.beforeToolCall } : {}),
    });

    // Re-emit every agent event as a generic "changed" signal for React, and
    // track the in-flight tool so the UI can show a "Running …" indicator.
    this.agent.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        this.activeToolName = event.toolName;
        // First tool of the turn → the agent is now acting on the page.
        if (!this.turnActive) {
          this.turnActive = true;
          this.onAgentActive?.(true);
        }
      } else if (event.type === "tool_execution_end") {
        this.activeToolName = undefined;
      } else if (event.type === "agent_end") {
        // Turn over; only signal if a tool actually ran (pure-text turns don't glow).
        if (this.turnActive) {
          this.turnActive = false;
          this.onAgentActive?.(false);
        }
      }
      for (const listener of this.listeners) listener();
    });
  }

  /** Subscribe to state changes (for React re-render). Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  currentModel(): Model<Api> {
    return this.agent.state.model;
  }

  setModel(model: Model<Api>): void {
    this.agent.state.model = model;
    for (const listener of this.listeners) listener();
  }

  isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  error(): string | undefined {
    return this.agent.state.errorMessage;
  }

  activeTool(): string | undefined {
    return this.activeToolName;
  }

  /** UI view of the conversation, including the in-flight streaming reply. */
  getMessages(): ChatMessageView[] {
    const views: ChatMessageView[] = [];
    for (const msg of this.agent.state.messages) {
      if (msg.role === "user") {
        views.push({ role: "user", text: stripReminders(messageText(msg.content)) });
      } else if (msg.role === "assistant") {
        // Assistant turns that are pure tool calls have no text — skip them so
        // the UI doesn't render empty bubbles.
        const text = messageText(msg.content);
        if (text.length > 0) views.push({ role: "assistant", text });
      }
    }
    const streaming = this.agent.state.streamingMessage;
    if (streaming && streaming.role === "assistant") {
      const text = messageText(streaming.content);
      if (text.length > 0) views.push({ role: "assistant", text });
    }
    return views;
  }

  /** Rich UI transcript: seeded history (text + tools) plus this session's live
   *  turns. The agent is seeded text-only, so live items start past `seedCount`
   *  and never double-count the seeded text. */
  getTranscript(): TranscriptItem[] {
    const live = buildTranscript(
      this.agent.state.messages.slice(this.seedCount),
      this.agent.state.streamingMessage ?? undefined,
    );
    return this.seededTranscript.length ? [...this.seededTranscript, ...live] : live;
  }

  /** Send a user message and await the assistant turn. No-op while streaming.
   *  Prepends a tab-context reminder so the model knows the current page without
   *  asking or spending a tool call; orientation is best-effort and never blocks. */
  async send(text: string): Promise<void> {
    if (this.agent.state.isStreaming) return;
    let prompt = text;
    if (this.getPageContext) {
      try {
        const ctx = await this.getPageContext();
        if (ctx?.url) prompt = `${formatTabReminder(ctx)}\n\n${text}`;
      } catch {
        // Orientation is a nicety — a failed tab lookup must not break the turn.
      }
    }
    await this.agent.prompt(prompt);
  }

  abort(): void {
    this.agent.abort();
  }
}
