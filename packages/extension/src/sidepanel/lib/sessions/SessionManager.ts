import type { Collection } from "../storage/idb.ts";
import type { ChatMessageView, ChatSessionLike } from "../chat.ts";
import type { TranscriptItem } from "../transcript.ts";
import type { Conversation, ConversationSummary, StoredMessage } from "./types.ts";

export interface CreateSessionArgs {
  providerSlug: string;
  modelId: string;
  initialMessages?: ChatMessageView[];
  initialTranscript?: TranscriptItem[];
}

export interface SessionManagerDeps {
  conversations: Collection<Conversation>;
  messages: Collection<StoredMessage>;
  createSession: (args: CreateSessionArgs) => ChatSessionLike;
  now?: () => number;
  newId?: () => string;
  getOrigin?: () => Promise<string | undefined>;
}

const TITLE_MAX = 60;

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1) + "…" : t;
}

interface ActiveState {
  /** undefined until the first send persists the conversation. */
  conversation?: Conversation;
  providerSlug: string;
  modelId: string;
  session: ChatSessionLike;
  seq: number;
  unsubscribe: () => void;
}

export class SessionManager {
  private readonly conversations: Collection<Conversation>;
  private readonly messages: Collection<StoredMessage>;
  private readonly createSession: (args: CreateSessionArgs) => ChatSessionLike;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly getOrigin: () => Promise<string | undefined>;

  private summaries: ConversationSummary[] = [];
  private active?: ActiveState;
  /** Serializes send() so overlapping calls can't race the lazy conversation create. */
  private sending = false;
  private readonly listeners = new Set<() => void>();

  constructor(deps: SessionManagerDeps) {
    this.conversations = deps.conversations;
    this.messages = deps.messages;
    this.createSession = deps.createSession;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.getOrigin = deps.getOrigin ?? (async () => undefined);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  async init(): Promise<void> {
    await this.refreshList();
  }

  private async refreshList(): Promise<void> {
    const all = await this.conversations.getAll();
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    this.summaries = all.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, origin: c.origin }));
    this.emit();
  }

  list(): ConversationSummary[] {
    return this.summaries;
  }

  activeId(): string | undefined {
    return this.active?.conversation?.id;
  }

  activeSession(): ChatSessionLike | undefined {
    return this.active?.session;
  }

  private setActive(
    providerSlug: string,
    modelId: string,
    conversation: Conversation | undefined,
    initialMessages: ChatMessageView[] | undefined,
    initialTranscript: TranscriptItem[] | undefined,
    seq: number,
  ): void {
    // Stop any in-flight turn on the outgoing session so it can't keep streaming
    // orphaned after we've replaced it.
    this.active?.session.abort();
    this.active?.unsubscribe();
    const session = this.createSession({ providerSlug, modelId, initialMessages, initialTranscript });
    const unsubscribe = session.subscribe(() => this.emit());
    this.active = { conversation, providerSlug, modelId, session, seq, unsubscribe };
    this.emit();
  }

  /** Start a fresh, not-yet-persisted conversation. */
  startNew(providerSlug: string, modelId: string): void {
    this.setActive(providerSlug, modelId, undefined, undefined, undefined, 0);
  }

  /** Reopen a stored conversation, seeding the session with its messages. */
  async open(id: string): Promise<Conversation | undefined> {
    const conversation = await this.conversations.get(id);
    if (!conversation) return undefined;
    const msgs = (await this.messages.getAllByIndex("conversationId", id)).sort((a, b) => a.seq - b.seq);
    // Agent seed: text rows only (cheap LLM history — unchanged behavior).
    const views: ChatMessageView[] = msgs
      .filter((m) => (m.kind ?? "text") === "text")
      .map((m) => ({ role: m.role, text: m.text ?? "" }));
    // Display seed: every row, including tool calls, as rich transcript items.
    const transcript: TranscriptItem[] = msgs.map((m) =>
      (m.kind ?? "text") === "tool"
        ? {
            kind: "tool",
            id: m.id,
            name: m.toolName ?? "",
            args: m.argsJson ? (JSON.parse(m.argsJson) as Record<string, unknown>) : {},
            status: m.status ?? "ok",
            result: {
              text: m.resultText,
              image: m.resultImageData
                ? { data: m.resultImageData, mimeType: m.resultImageMime ?? "image/png" }
                : undefined,
            },
            error: m.status === "error" ? m.resultText : undefined,
          }
        : { kind: "text", id: m.id, role: m.role, text: m.text ?? "" },
    );
    const nextSeq = msgs.length ? msgs[msgs.length - 1]!.seq + 1 : 0;
    this.setActive(conversation.provider, conversation.model, conversation, views, transcript, nextSeq);
    return conversation;
  }

  /** Swap the model for the active conversation, preserving its transcript. */
  setModel(providerSlug: string, modelId: string): void {
    const a = this.active;
    if (!a) return;
    // If a turn is mid-stream, the last entry is an uncommitted partial reply —
    // drop it so it isn't baked into the rebuilt session's history.
    const wasStreaming = a.session.isStreaming();
    const transcript = a.session.getMessages();
    const clean =
      wasStreaming && transcript.at(-1)?.role === "assistant" ? transcript.slice(0, -1) : transcript;
    const conversation = a.conversation;
    this.setActive(providerSlug, modelId, conversation, clean, a.session.getTranscript(), a.seq);
    if (conversation) {
      conversation.provider = providerSlug;
      conversation.model = modelId;
      conversation.updatedAt = this.now();
      void this.persist(() => this.conversations.put(conversation)).then(() => this.refreshList());
    }
  }

  async send(text: string): Promise<void> {
    const a = this.active;
    if (!a) return;
    // Serialize: a second send while one is in flight (or while the underlying
    // session is streaming) would race the lazy create and corrupt seq order.
    if (this.sending || a.session.isStreaming()) return;
    const body = text.trim();
    if (!body) return;

    this.sending = true;
    try {
      // Lazily create the conversation on the first send.
      if (!a.conversation) {
        const ts = this.now();
        a.conversation = {
          id: this.newId(),
          title: titleFrom(body),
          origin: await this.getOrigin(),
          provider: a.providerSlug,
          model: a.modelId,
          createdAt: ts,
          updatedAt: ts,
        };
        await this.persist(() => this.conversations.put(a.conversation!));
      }
      const convId = a.conversation.id;

      // User message: persisted immediately.
      const userSeq = a.seq++;
      await this.persist(() =>
        this.messages.put({
          id: this.newId(),
          conversationId: convId,
          role: "user",
          text: body,
          seq: userSeq,
          createdAt: this.now(),
        }),
      );

      // Snapshot the transcript length so we persist only items produced by THIS
      // turn (the leading item is the user message, already persisted above).
      const before = a.session.getTranscript().length;

      // Run the turn; resolves when streaming completes (or is aborted).
      try {
        await a.session.send(body);
      } catch (e) {
        console.error("[sessions] turn failed", e);
      }

      // The active conversation may have been deleted or switched mid-turn; if so,
      // skip the post-turn writes so we don't resurrect or mis-attribute them.
      if (this.active !== a) return;

      // Persist every new item (assistant text + tool calls) in order. Skip the
      // leading user item — buildTranscript re-emits it and we stored it above.
      const newItems = a.session.getTranscript().slice(before);
      for (const item of newItems) {
        if (item.kind === "text") {
          if (item.role === "user") continue; // already persisted
          if (!item.text.trim()) continue; // skip empty assistant text
          const seq = a.seq++;
          await this.persist(() =>
            this.messages.put({
              id: this.newId(),
              conversationId: convId,
              role: "assistant",
              kind: "text",
              text: item.text,
              seq,
              createdAt: this.now(),
            }),
          );
        } else {
          // Tool item — persist with finalized status (skip still-running).
          if (item.status === "running") continue;
          const status = item.status; // "ok" | "error" — captured for the closure below
          const seq = a.seq++;
          await this.persist(() =>
            this.messages.put({
              id: this.newId(),
              conversationId: convId,
              role: "assistant",
              kind: "tool",
              toolName: item.name,
              argsJson: JSON.stringify(item.args ?? {}),
              status,
              resultText: item.result?.text,
              resultImageData: item.result?.image?.data,
              resultImageMime: item.result?.image?.mimeType,
              seq,
              createdAt: this.now(),
            }),
          );
        }
      }

      a.conversation.updatedAt = this.now();
      await this.persist(() => this.conversations.put(a.conversation!));
      await this.refreshList();
    } finally {
      this.sending = false;
    }
  }

  stop(): void {
    this.active?.session.abort();
  }

  async rename(id: string, title: string): Promise<void> {
    const conv = await this.conversations.get(id);
    if (!conv) return;
    conv.title = title.trim() || conv.title;
    conv.updatedAt = this.now();
    await this.persist(() => this.conversations.put(conv));
    if (this.active?.conversation?.id === id) this.active.conversation = conv;
    await this.refreshList();
  }

  async deleteConversation(id: string): Promise<void> {
    await this.persist(() => this.messages.deleteByIndex("conversationId", id));
    await this.persist(() => this.conversations.delete(id));
    if (this.active?.conversation?.id === id) {
      this.startNew(this.active.providerSlug, this.active.modelId);
    }
    await this.refreshList();
  }

  /** Run a persistence op; swallow storage errors so a chat turn never breaks. */
  private async persist(op: () => Promise<unknown>): Promise<void> {
    try {
      await op();
    } catch (e) {
      console.error("[sessions] persist failed", e);
    }
  }
}
