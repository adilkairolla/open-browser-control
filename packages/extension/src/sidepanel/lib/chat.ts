import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model, Api, AssistantMessage, UserMessage, Usage } from "@earendil-works/pi-ai";

export type ChatRole = "user" | "assistant";

export interface ChatMessageView {
  role: ChatRole;
  text: string;
}

export interface ChatSessionOptions {
  model: Model<Api>;
  getToken: (provider: string) => Promise<string | undefined> | string | undefined;
  systemPrompt?: string;
  /** Prior turns to seed the agent with (for reopening a stored conversation). */
  initialMessages?: ChatMessageView[];
  /** Test-only override of the LLM call. Production omits it (uses pi's default). */
  streamFn?: StreamFn;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

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
  isStreaming(): boolean;
  error(): string | undefined;
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

  constructor(options: ChatSessionOptions) {
    this.agent = new Agent({
      initialState: {
        model: options.model,
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        thinkingLevel: "off",
        tools: [],
        messages: (options.initialMessages ?? []).map((m) => toAgentMessage(m, options.model)),
      },
      getApiKey: (provider) => options.getToken(provider),
      ...(options.streamFn ? { streamFn: options.streamFn } : {}),
    });

    // Re-emit every agent event as a generic "changed" signal for React.
    this.agent.subscribe(() => {
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

  /** UI view of the conversation, including the in-flight streaming reply. */
  getMessages(): ChatMessageView[] {
    const views: ChatMessageView[] = [];
    for (const msg of this.agent.state.messages) {
      if (msg.role === "user") views.push({ role: "user", text: messageText(msg.content) });
      else if (msg.role === "assistant") views.push({ role: "assistant", text: messageText(msg.content) });
    }
    const streaming = this.agent.state.streamingMessage;
    if (streaming && streaming.role === "assistant") {
      views.push({ role: "assistant", text: messageText(streaming.content) });
    }
    return views;
  }

  /** Send a user message and await the assistant turn. No-op while streaming. */
  async send(text: string): Promise<void> {
    if (this.agent.state.isStreaming) return;
    await this.agent.prompt(text);
  }

  abort(): void {
    this.agent.abort();
  }
}
