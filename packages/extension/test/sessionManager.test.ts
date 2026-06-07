import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openSessionsDb } from "../src/sidepanel/lib/sessions/db.ts";
import { SessionManager, type CreateSessionArgs } from "../src/sidepanel/lib/sessions/SessionManager.ts";
import type { ChatMessageView, ChatSessionLike } from "../src/sidepanel/lib/chat.ts";

/**
 * A controllable fake session. By default send() synchronously appends the user
 * turn and a canned reply. Set `reply=""` to model a turn with no assistant
 * output; set `streaming=true` to model an in-flight turn; use openGate()/
 * releaseGate() to hold a send() mid-flight and exercise concurrency paths.
 */
class FakeSession implements ChatSessionLike {
  msgs: ChatMessageView[];
  reply = "ok";
  streaming = false;
  aborted = false;
  private gate: { promise: Promise<void>; resolve: () => void } | null = null;
  private listeners = new Set<() => void>();
  constructor(initial: ChatMessageView[] = []) {
    this.msgs = [...initial];
  }
  /** Make the next send() block until releaseGate() is called. */
  openGate(): void {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.gate = { promise, resolve };
  }
  releaseGate(): void {
    this.gate?.resolve();
    this.gate = null;
  }
  async send(text: string): Promise<void> {
    this.msgs.push({ role: "user", text });
    this.streaming = true;
    if (this.gate) await this.gate.promise;
    if (this.reply) this.msgs.push({ role: "assistant", text: this.reply });
    this.streaming = false;
    for (const l of this.listeners) l();
  }
  abort(): void {
    this.aborted = true;
  }
  getMessages(): ChatMessageView[] {
    return this.msgs;
  }
  isStreaming(): boolean {
    return this.streaming;
  }
  error(): string | undefined {
    return undefined;
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

function build() {
  const { conversations, messages } = openSessionsDb(new IDBFactory());
  const created: CreateSessionArgs[] = [];
  let last: FakeSession | undefined;
  let t = 1000;
  let n = 0;
  const mgr = new SessionManager({
    conversations,
    messages,
    createSession: (args) => {
      created.push(args);
      last = new FakeSession(args.initialMessages);
      return last;
    },
    now: () => t++,
    newId: () => `id${n++}`,
    getOrigin: async () => "example.com",
  });
  return { mgr, conversations, messages, created, getLast: () => last };
}

describe("SessionManager", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => {
    h = build();
  });

  test("first send creates the conversation and persists user then assistant in order", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("Hello there");

    const convos = await h.conversations.getAll();
    expect(convos).toHaveLength(1);
    const conv = convos[0]!;
    expect(conv.provider).toBe("openrouter");
    expect(conv.model).toBe("m1");

    const msgs = (await h.messages.getAllByIndex("conversationId", conv.id)).sort((a, b) => a.seq - b.seq);
    expect(msgs.map((m) => [m.role, m.text, m.seq])).toEqual([
      ["user", "Hello there", 0],
      ["assistant", "ok", 1],
    ]);
  });

  test("title is derived from the first user message", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("Summarize this page please");
    const conv = (await h.conversations.getAll())[0]!;
    expect(conv.title).toBe("Summarize this page please");
  });

  test("long titles are truncated to 60 chars with an ellipsis", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    const long = "x".repeat(100);
    await h.mgr.send(long);
    const conv = (await h.conversations.getAll())[0]!;
    expect(conv.title.length).toBe(60);
    expect(conv.title.endsWith("…")).toBe(true);
  });

  test("origin is recorded from getOrigin", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    expect((await h.conversations.getAll())[0]!.origin).toBe("example.com");
  });

  test("an empty assistant reply is not persisted", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    h.getLast()!.reply = "";
    await h.mgr.send("hi");
    const conv = (await h.conversations.getAll())[0]!;
    const msgs = await h.messages.getAllByIndex("conversationId", conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user"]);
  });

  test("list() is sorted by updatedAt descending", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("first");
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("second");
    const titles = h.mgr.list().map((c) => c.title);
    expect(titles).toEqual(["second", "first"]);
  });

  test("open() rehydrates the session with stored messages in order", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    const id = h.mgr.activeId()!;

    h.mgr.startNew("openrouter", "m1"); // move away
    await h.mgr.open(id);

    const seeded = h.created.at(-1)!.initialMessages;
    expect(seeded).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "ok" },
    ]);
    expect(h.mgr.activeId()).toBe(id);
  });

  test("a second send in the same conversation continues the seq", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("one");
    const id = h.mgr.activeId()!;
    await h.mgr.send("two");
    const seqs = (await h.messages.getAllByIndex("conversationId", id)).map((m) => m.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1, 2, 3]);
  });

  test("deleteConversation removes the conversation and its messages", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    const id = h.mgr.activeId()!;
    await h.mgr.deleteConversation(id);
    expect(await h.conversations.get(id)).toBeUndefined();
    expect(await h.messages.getAllByIndex("conversationId", id)).toEqual([]);
    expect(h.mgr.list()).toEqual([]);
  });

  test("rename updates the stored title", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    const id = h.mgr.activeId()!;
    await h.mgr.rename(id, "Renamed");
    expect((await h.conversations.get(id))?.title).toBe("Renamed");
  });

  test("setModel updates the active conversation's provider/model", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    const id = h.mgr.activeId()!;
    h.mgr.setModel("anthropic", "claude-x");
    // setModel persists asynchronously; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    const conv = await h.conversations.get(id);
    expect(conv?.provider).toBe("anthropic");
    expect(conv?.model).toBe("claude-x");
  });

  // --- Regression tests for issues found in adversarial review ---

  test("a rehydrated turn with no new assistant reply does not duplicate the old one", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    const id = h.mgr.activeId()!;

    await h.mgr.open(id); // rehydrate: new session seeded with [user hi, assistant ok]
    h.getLast()!.reply = ""; // this turn produces NO assistant message
    await h.mgr.send("again");

    const msgs = (await h.messages.getAllByIndex("conversationId", id)).sort((a, b) => a.seq - b.seq);
    expect(msgs.map((m) => [m.role, m.text])).toEqual([
      ["user", "hi"],
      ["assistant", "ok"],
      ["user", "again"],
    ]);
  });

  test("send is a no-op while the session is already streaming", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    h.getLast()!.streaming = true;
    await h.mgr.send("hi");
    expect(await h.conversations.getAll()).toEqual([]);
  });

  test("overlapping sends do not create duplicate conversations", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    const s = h.getLast()!;
    s.openGate();
    const p1 = h.mgr.send("first"); // enters, persists user, blocks on gate
    const p2 = h.mgr.send("second"); // must be dropped while p1 is in flight
    s.releaseGate();
    await Promise.all([p1, p2]);
    expect((await h.conversations.getAll()).length).toBe(1);
  });

  test("deleting the active conversation mid-send does not resurrect it", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    await h.mgr.send("hi");
    const id = h.mgr.activeId()!;

    const s = h.getLast()!;
    s.openGate();
    const p = h.mgr.send("second"); // persists user, blocks on gate
    await h.mgr.deleteConversation(id); // delete while the turn is in flight
    s.releaseGate();
    await p;

    expect(await h.conversations.get(id)).toBeUndefined();
  });

  test("setModel drops an in-flight assistant partial when rebuilding", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    const s = h.getLast()!;
    s.msgs = [
      { role: "user", text: "hi" },
      { role: "assistant", text: "partial…" },
    ];
    s.streaming = true;

    h.mgr.setModel("anthropic", "claude-x");

    expect(h.created.at(-1)!.initialMessages).toEqual([{ role: "user", text: "hi" }]);
    expect(s.aborted).toBe(true);
  });
});
