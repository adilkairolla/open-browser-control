import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model, Api, AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export type ChatRole = "user" | "assistant";

export interface ChatMessageView {
  role: ChatRole;
  text: string;
}

export interface ChatSessionOptions {
  model: Model<Api>;
  getToken: (provider: string) => Promise<string | undefined> | string | undefined;
  systemPrompt?: string;
  /** Test-only override of the LLM call. Production omits it (uses pi's default). */
  streamFn?: StreamFn;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

/** Join the text parts of an LLM message into a plain string. */
function messageText(content: AssistantMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class ChatSession {
  private readonly agent: Agent;
  private readonly listeners = new Set<() => void>();

  constructor(options: ChatSessionOptions) {
    this.agent = new Agent({
      initialState: {
        model: options.model,
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        thinkingLevel: "off",
        tools: [],
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
