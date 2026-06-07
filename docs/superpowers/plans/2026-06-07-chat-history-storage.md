# Chat History Storage + Session Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat conversations and their messages so users keep a browsable history, built on a reusable, app-agnostic storage layer.

**Architecture:** Two layers. **Layer 1 (`lib/storage/`)** is domain-free: the existing `Kv` (chrome.storage.local) for small singletons, plus a new generic `Database`/`Collection<T>` wrapper over IndexedDB for record sets — neither knows anything about chat. **Layer 2 (`lib/sessions/`)** is the app domain: a `SessionManager` that stores conversations + messages in two IndexedDB collections, persists the user message on send and the assistant reply on completion, derives titles from the first message, records the originating site, and rehydrates a `ChatSession` (pi `Agent`) when reopening a thread. A thin `useSessions` hook adapts the manager to `ChatViewProps`, and a `ConversationsDrawer` exposes the history.

**Tech Stack:** TypeScript 6 (strict, verbatimModuleSyntax), React 19, Bun test, IndexedDB (`fake-indexeddb` v6 in tests), `@earendil-works/pi-agent-core` + `pi-ai`, chrome.storage.local.

---

## Pre-flight (read before Task 1)

- **Working dir for all paths below:** `packages/extension/` (the `@obc/extension` workspace). Paths in this plan are relative to it unless noted.
- **Branch first.** The repo root (`/Users/nosferatu/Projects/personal/open-browser-control`) is on `main` with a large uncommitted stack. Do NOT implement on `main`. Create a branch, e.g. `git checkout -b feat/chat-history`. Per project convention, **committing/pushing is the user's call** — the commit steps below are the intended granularity, but only run them with the user's go-ahead. If the user prefers, batch the commits at task boundaries.
- **Run tests with:** `bun test` (from `packages/extension/`). There is no `test` npm script; bun auto-discovers `test/*.test.ts`.
- **Typecheck with:** `bun run typecheck` (runs `tsc --noEmit`; `test/` is included in the program, so test files must typecheck).
- **Build checks:** `bun run build` (extension via Vite) and `bun run build:demo` (playground).
- `fake-indexeddb@6.2.5` is already installed as a devDependency (added during planning). If a clean install is needed: `bun add -d fake-indexeddb`.

### File map (what each new/changed file is responsible for)

| File | Responsibility |
|---|---|
| `src/sidepanel/lib/storage/kv.ts` | *(moved)* `Kv` interface + `ChromeKv`/`MemoryKv` + `defaultKv`. Small singletons. |
| `src/sidepanel/lib/storage/idb.ts` | *(new)* Domain-free `Database` + `Collection<T>` over IndexedDB. No app types. |
| `src/sidepanel/lib/sessions/types.ts` | *(new)* `Conversation`, `StoredMessage`, `ConversationSummary`. |
| `src/sidepanel/lib/sessions/db.ts` | *(new)* `openSessionsDb()` — declares the `obc` DB stores/indexes, returns the two typed collections. |
| `src/sidepanel/lib/sessions/SessionManager.ts` | *(new)* The app brain: list/create/open/delete/rename + persist-on-send + rehydration. |
| `src/sidepanel/lib/chat.ts` | *(modify)* Add `initialMessages` option + `ChatSessionLike` interface. |
| `src/sidepanel/lib/time.ts` | *(new)* `relativeTime(ts, now)` pure formatter for the drawer. |
| `src/sidepanel/components/chat/useSessions.ts` | *(new)* React hook adapting `SessionManager` → `ChatViewProps` data + handlers; exports pure `toUiMessages`. |
| `src/sidepanel/components/chat/ConversationsDrawer.tsx` | *(new)* Presentational history panel (list, open, delete, new chat). |
| `src/sidepanel/components/chat/useSessionView.ts` | *(delete in Task 9)* superseded by `useSessions`. |
| `src/sidepanel/App.tsx` | *(modify)* Wire `useSessions` + drawer; replace ephemeral session. |
| `src/demo/mock.ts` / `preview.tsx` / `Demo.tsx` | *(modify)* Add a `conversations` screen + mock data for playground testing. |
| `manifest.json` | *(modify)* Add `unlimitedStorage`. |

---

## Task 1: Relocate KV into the storage module

Pure move so the domain-free storage helpers live together. No behavior change.

**Files:**
- Create: `src/sidepanel/lib/storage/kv.ts`
- Delete: `src/sidepanel/lib/kv.ts`
- Modify: `src/sidepanel/lib/authStore.ts:1-2`, `src/sidepanel/lib/settingsStore.ts:1-2`
- Modify: `test/kv.test.ts:2`

- [ ] **Step 1: Create the new file with the exact current content**

Create `src/sidepanel/lib/storage/kv.ts`:

```ts
/** Minimal async key-value interface, backed by chrome.storage.local in prod. */
export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** In-memory implementation for tests. */
export class MemoryKv implements Kv {
  private readonly map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** chrome.storage.local-backed implementation for the extension runtime. */
export class ChromeKv implements Kv {
  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}

/** Default store used by the app (overridable in tests). */
export const defaultKv: Kv = new ChromeKv();
```

- [ ] **Step 2: Delete the old file**

```bash
rm src/sidepanel/lib/kv.ts
```

- [ ] **Step 3: Update the two importers**

In `src/sidepanel/lib/authStore.ts`, change lines 1–2 from:

```ts
import type { Kv } from "./kv.ts";
import { defaultKv } from "./kv.ts";
```

to:

```ts
import type { Kv } from "./storage/kv.ts";
import { defaultKv } from "./storage/kv.ts";
```

Make the identical change in `src/sidepanel/lib/settingsStore.ts` (same two lines).

- [ ] **Step 4: Update the test import**

In `test/kv.test.ts`, change line 2 from:

```ts
import { MemoryKv } from "../src/sidepanel/lib/kv.ts";
```

to:

```ts
import { MemoryKv } from "../src/sidepanel/lib/storage/kv.ts";
```

- [ ] **Step 5: Verify nothing else references the old path**

Run: `grep -rn "lib/kv" src test`
Expected: no matches (only `lib/storage/kv` references remain).

- [ ] **Step 6: Run the affected tests**

Run: `bun test test/kv.test.ts test/authStore.test.ts test/settingsStore.test.ts`
Expected: PASS (all green, same counts as before).

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/lib/storage/kv.ts src/sidepanel/lib/authStore.ts src/sidepanel/lib/settingsStore.ts test/kv.test.ts
git commit -m "refactor: relocate kv into lib/storage"
```

---

## Task 2: Generic IndexedDB Database + Collection

Domain-free IndexedDB wrapper. Knows nothing about conversations.

**Files:**
- Create: `src/sidepanel/lib/storage/idb.ts`
- Test: `test/idb.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/idb.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { Database, type DatabaseSpec } from "../src/sidepanel/lib/storage/idb.ts";

interface Row {
  id: string;
  group: string;
  n: number;
}

const SPEC: DatabaseSpec = {
  name: "test-db",
  version: 1,
  stores: [{ name: "rows", keyPath: "id", indexes: [{ name: "group", keyPath: "group" }] }],
};

function freshCollection() {
  const db = new Database(SPEC, new IDBFactory());
  return db.collection<Row>("rows");
}

describe("idb Collection", () => {
  test("get returns undefined for a missing id", async () => {
    const c = freshCollection();
    expect(await c.get("nope")).toBeUndefined();
  });

  test("put then get round-trips a record", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    expect(await c.get("a")).toEqual({ id: "a", group: "g1", n: 1 });
  });

  test("put upserts an existing id", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "a", group: "g1", n: 2 });
    expect((await c.get("a"))?.n).toBe(2);
    expect(await c.count()).toBe(1);
  });

  test("getAll returns every record", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g2", n: 2 });
    const all = await c.getAll();
    expect(all.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("getAllByIndex filters by an index value", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g1", n: 2 });
    await c.put({ id: "c", group: "g2", n: 3 });
    const g1 = await c.getAllByIndex("group", "g1");
    expect(g1.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("deleteByIndex removes all matching records", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g1", n: 2 });
    await c.put({ id: "c", group: "g2", n: 3 });
    await c.deleteByIndex("group", "g1");
    expect(await c.count()).toBe(1);
    expect((await c.getAll())[0]?.id).toBe("c");
  });

  test("delete removes a single record and clear empties the store", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g1", n: 2 });
    await c.delete("a");
    expect(await c.get("a")).toBeUndefined();
    await c.clear();
    expect(await c.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/idb.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/storage/idb.ts` (module does not exist yet).

- [ ] **Step 3: Implement the wrapper**

Create `src/sidepanel/lib/storage/idb.ts`:

```ts
/**
 * Domain-free IndexedDB helpers. A `Database` declares its stores + indexes once
 * and hands out typed `Collection<T>` handles. No app types live here — this is a
 * reusable record store (conversations, messages, skills, memory, …).
 */

export interface IndexSpec {
  name: string;
  keyPath: string;
  unique?: boolean;
}

export interface StoreSpec {
  /** Object store name. */
  name: string;
  /** Property used as the primary key (records must carry it). */
  keyPath: string;
  indexes?: IndexSpec[];
}

export interface DatabaseSpec {
  name: string;
  version: number;
  stores: StoreSpec[];
}

export class Database {
  private dbp?: Promise<IDBDatabase>;

  constructor(
    private readonly spec: DatabaseSpec,
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(this.spec.name, this.spec.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of this.spec.stores) {
            if (db.objectStoreNames.contains(store.name)) continue;
            const os = db.createObjectStore(store.name, { keyPath: store.keyPath });
            for (const idx of store.indexes ?? []) {
              os.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
            }
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  collection<T>(store: string): Collection<T> {
    return new Collection<T>(this, store);
  }

  /**
   * Run `fn` inside a transaction on `store` and resolve when the transaction
   * COMMITS (not merely when the request succeeds), so writes are durable.
   */
  async tx<R>(
    store: string,
    mode: IDBTransactionMode,
    fn: (os: IDBObjectStore) => IDBRequest<R> | void,
  ): Promise<R | undefined> {
    const db = await this.open();
    return new Promise<R | undefined>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const os = transaction.objectStore(store);
      let result: R | undefined;
      const req = fn(os);
      if (req) {
        req.onsuccess = () => {
          result = req.result;
        };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

/** A typed handle to one object store. `T` must contain the store's keyPath field. */
export class Collection<T> {
  constructor(
    private readonly db: Database,
    private readonly store: string,
  ) {}

  get(id: IDBValidKey): Promise<T | undefined> {
    return this.db.tx<T>(this.store, "readonly", (os) => os.get(id) as IDBRequest<T>);
  }

  put(value: T): Promise<void> {
    return this.db.tx(this.store, "readwrite", (os) => os.put(value)).then(() => undefined);
  }

  delete(id: IDBValidKey): Promise<void> {
    return this.db.tx(this.store, "readwrite", (os) => os.delete(id)).then(() => undefined);
  }

  getAll(): Promise<T[]> {
    return this.db.tx<T[]>(this.store, "readonly", (os) => os.getAll()).then((r) => r ?? []);
  }

  getAllByIndex(index: string, value: IDBValidKey): Promise<T[]> {
    return this.db
      .tx<T[]>(this.store, "readonly", (os) => os.index(index).getAll(value))
      .then((r) => r ?? []);
  }

  async deleteByIndex(index: string, value: IDBValidKey): Promise<void> {
    const keys =
      (await this.db.tx<IDBValidKey[]>(this.store, "readonly", (os) =>
        os.index(index).getAllKeys(value),
      )) ?? [];
    for (const key of keys) {
      await this.db.tx(this.store, "readwrite", (os) => os.delete(key));
    }
  }

  count(): Promise<number> {
    return this.db.tx<number>(this.store, "readonly", (os) => os.count()).then((r) => r ?? 0);
  }

  clear(): Promise<void> {
    return this.db.tx(this.store, "readwrite", (os) => os.clear()).then(() => undefined);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/idb.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/lib/storage/idb.ts test/idb.test.ts package.json
git commit -m "feat: generic IndexedDB Database/Collection helper"
```

---

## Task 3: Sessions data layer (types + db)

App-domain record shapes and the concrete `obc` database.

**Files:**
- Create: `src/sidepanel/lib/sessions/types.ts`
- Create: `src/sidepanel/lib/sessions/db.ts`
- Test: `test/sessionsDb.test.ts`

- [ ] **Step 1: Create the types**

Create `src/sidepanel/lib/sessions/types.ts`:

```ts
/** Persistent chat-history record shapes. */

export type StoredRole = "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  /** Hostname where the conversation started (e.g. "github.com"); undefined if unknown. */
  origin?: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: StoredRole;
  text: string;
  /** Monotonic order within a conversation (0, 1, 2 …). */
  seq: number;
  createdAt: number;
}

/** Lightweight projection for the history list (no message bodies). */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  origin?: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/sessionsDb.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openSessionsDb } from "../src/sidepanel/lib/sessions/db.ts";

describe("openSessionsDb", () => {
  test("round-trips a conversation and queries messages by conversationId", async () => {
    const { conversations, messages } = openSessionsDb(new IDBFactory());

    await conversations.put({
      id: "c1",
      title: "First chat",
      origin: "example.com",
      provider: "openrouter",
      model: "anthropic/claude-opus-4.8",
      createdAt: 1,
      updatedAt: 2,
    });
    await messages.put({ id: "m1", conversationId: "c1", role: "user", text: "hi", seq: 0, createdAt: 1 });
    await messages.put({ id: "m2", conversationId: "c1", role: "assistant", text: "yo", seq: 1, createdAt: 2 });
    await messages.put({ id: "m3", conversationId: "c2", role: "user", text: "other", seq: 0, createdAt: 3 });

    expect((await conversations.get("c1"))?.title).toBe("First chat");
    const forC1 = await messages.getAllByIndex("conversationId", "c1");
    expect(forC1.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test test/sessionsDb.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/sessions/db.ts`.

- [ ] **Step 4: Implement the db opener**

Create `src/sidepanel/lib/sessions/db.ts`:

```ts
import { Database, type Collection, type DatabaseSpec } from "../storage/idb.ts";
import type { Conversation, StoredMessage } from "./types.ts";

const DB_SPEC: DatabaseSpec = {
  name: "obc",
  version: 1,
  stores: [
    { name: "conversations", keyPath: "id", indexes: [{ name: "updatedAt", keyPath: "updatedAt" }] },
    { name: "messages", keyPath: "id", indexes: [{ name: "conversationId", keyPath: "conversationId" }] },
  ],
};

export interface SessionsDb {
  conversations: Collection<Conversation>;
  messages: Collection<StoredMessage>;
}

/** Open the chat-history database. Pass a factory in tests (fake-indexeddb). */
export function openSessionsDb(factory?: IDBFactory): SessionsDb {
  const db = factory ? new Database(DB_SPEC, factory) : new Database(DB_SPEC);
  return {
    conversations: db.collection<Conversation>("conversations"),
    messages: db.collection<StoredMessage>("messages"),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/sessionsDb.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/lib/sessions/types.ts src/sidepanel/lib/sessions/db.ts test/sessionsDb.test.ts
git commit -m "feat: sessions data layer (types + obc db)"
```

---

## Task 4: ChatSession rehydration + ChatSessionLike

Let a `ChatSession` start from prior messages (so reopened threads keep model context), and publish a minimal interface the manager depends on.

**Files:**
- Modify: `src/sidepanel/lib/chat.ts`
- Test: `test/chat.test.ts` (add one test)

- [ ] **Step 1: Add the failing test**

In `test/chat.test.ts`, add this test inside the `describe("ChatSession", …)` block (after the `setModel` test):

```ts
  test("seeds initial messages into the view", () => {
    const session = new ChatSession({
      model,
      getToken: async () => "k",
      initialMessages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "hello" },
      ],
    });
    expect(session.getMessages()).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/chat.test.ts`
Expected: FAIL — `initialMessages` is not a known option / view is empty.

- [ ] **Step 3: Implement the option + interface**

In `src/sidepanel/lib/chat.ts`:

(a) Extend the type imports on lines 1–3 to add `AgentMessage` and `Usage`:

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model, Api, AssistantMessage, UserMessage, Usage } from "@earendil-works/pi-ai";
```

(b) Add `initialMessages` to `ChatSessionOptions` (after the `systemPrompt?` field):

```ts
export interface ChatSessionOptions {
  model: Model<Api>;
  getToken: (provider: string) => Promise<string | undefined> | string | undefined;
  systemPrompt?: string;
  /** Prior turns to seed the agent with (for reopening a stored conversation). */
  initialMessages?: ChatMessageView[];
  /** Test-only override of the LLM call. Production omits it (uses pi's default). */
  streamFn?: StreamFn;
}
```

(c) After the `DEFAULT_SYSTEM_PROMPT` constant, add a zero-usage constant and a mapper:

```ts
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
```

(d) Declare the class implements the interface — change the class line:

```ts
export class ChatSession implements ChatSessionLike {
```

(e) Seed the agent in the constructor. Replace the existing `this.agent = new Agent({ … });` block with:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/chat.test.ts`
Expected: PASS (existing tests + the new one; the live OpenRouter test stays skipped).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/lib/chat.ts test/chat.test.ts
git commit -m "feat: ChatSession initialMessages + ChatSessionLike"
```

---

## Task 5: SessionManager

The core. Owns the active live session, persists user-on-send / assistant-on-complete, derives titles, records origin, rehydrates on open. Fully unit-tested with fakes.

**Files:**
- Create: `src/sidepanel/lib/sessions/SessionManager.ts`
- Test: `test/sessionManager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/sessionManager.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openSessionsDb } from "../src/sidepanel/lib/sessions/db.ts";
import { SessionManager, type CreateSessionArgs } from "../src/sidepanel/lib/sessions/SessionManager.ts";
import type { ChatMessageView, ChatSessionLike } from "../src/sidepanel/lib/chat.ts";

/** A controllable fake session: each send() appends the user turn and a canned reply. */
class FakeSession implements ChatSessionLike {
  msgs: ChatMessageView[];
  reply = "ok";
  private listeners = new Set<() => void>();
  constructor(initial: ChatMessageView[] = []) {
    this.msgs = [...initial];
  }
  async send(text: string): Promise<void> {
    this.msgs.push({ role: "user", text });
    if (this.reply) this.msgs.push({ role: "assistant", text: this.reply });
    for (const l of this.listeners) l();
  }
  abort(): void {}
  getMessages(): ChatMessageView[] {
    return this.msgs;
  }
  isStreaming(): boolean {
    return false;
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/sessionManager.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/sessions/SessionManager.ts`.

- [ ] **Step 3: Implement the manager**

Create `src/sidepanel/lib/sessions/SessionManager.ts`:

```ts
import type { Collection } from "../storage/idb.ts";
import type { ChatMessageView, ChatSessionLike } from "../chat.ts";
import type { Conversation, ConversationSummary, StoredMessage } from "./types.ts";

export interface CreateSessionArgs {
  providerSlug: string;
  modelId: string;
  initialMessages?: ChatMessageView[];
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
    seq: number,
  ): void {
    this.active?.unsubscribe();
    const session = this.createSession({ providerSlug, modelId, initialMessages });
    const unsubscribe = session.subscribe(() => this.emit());
    this.active = { conversation, providerSlug, modelId, session, seq, unsubscribe };
    this.emit();
  }

  /** Start a fresh, not-yet-persisted conversation. */
  startNew(providerSlug: string, modelId: string): void {
    this.setActive(providerSlug, modelId, undefined, undefined, 0);
  }

  /** Reopen a stored conversation, seeding the session with its messages. */
  async open(id: string): Promise<Conversation | undefined> {
    const conversation = await this.conversations.get(id);
    if (!conversation) return undefined;
    const msgs = (await this.messages.getAllByIndex("conversationId", id)).sort((a, b) => a.seq - b.seq);
    const views: ChatMessageView[] = msgs.map((m) => ({ role: m.role, text: m.text }));
    const nextSeq = msgs.length ? msgs[msgs.length - 1]!.seq + 1 : 0;
    this.setActive(conversation.provider, conversation.model, conversation, views, nextSeq);
    return conversation;
  }

  /** Swap the model for the active conversation, preserving its transcript. */
  setModel(providerSlug: string, modelId: string): void {
    const a = this.active;
    if (!a) return;
    const transcript = a.session.getMessages();
    const conversation = a.conversation;
    this.setActive(providerSlug, modelId, conversation, transcript, a.seq);
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
    const body = text.trim();
    if (!body) return;

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

    // Run the turn; resolves when streaming completes (or is aborted).
    try {
      await a.session.send(body);
    } catch (e) {
      console.error("[sessions] turn failed", e);
    }

    // Assistant reply: persisted on completion, if non-empty.
    const assistant = a.session.getMessages().filter((m) => m.role === "assistant").at(-1);
    if (assistant && assistant.text.trim()) {
      const assistantSeq = a.seq++;
      await this.persist(() =>
        this.messages.put({
          id: this.newId(),
          conversationId: convId,
          role: "assistant",
          text: assistant.text,
          seq: assistantSeq,
          createdAt: this.now(),
        }),
      );
    }

    a.conversation.updatedAt = this.now();
    await this.persist(() => this.conversations.put(a.conversation!));
    await this.refreshList();
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/sessionManager.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/lib/sessions/SessionManager.ts test/sessionManager.test.ts
git commit -m "feat: SessionManager with persistence + rehydration"
```

---

## Task 6: relativeTime util

Small pure formatter for the drawer's timestamps.

**Files:**
- Create: `src/sidepanel/lib/time.ts`
- Test: `test/time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/time.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { relativeTime } from "../src/sidepanel/lib/time.ts";

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  test("just now for < 1 minute", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("just now");
  });
  test("minutes", () => {
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe("5m ago");
  });
  test("hours", () => {
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
  });
  test("days", () => {
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe("2d ago");
  });
  test("weeks", () => {
    expect(relativeTime(NOW - 14 * DAY, NOW)).toBe("2w ago");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/time.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/time.ts`.

- [ ] **Step 3: Implement it**

Create `src/sidepanel/lib/time.ts`:

```ts
/** Compact relative-time label, e.g. "just now", "5m ago", "3h ago", "2d ago", "2w ago". */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  const min = Math.floor(sec / 60);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  return `${wk}w ago`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/time.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/lib/time.ts test/time.test.ts
git commit -m "feat: relativeTime util"
```

---

## Task 7: useSessions hook + toUiMessages

React adapter over `SessionManager`. The hook itself is a thin shell (logic lives in the tested manager); the message mapper is pure and tested.

**Files:**
- Create: `src/sidepanel/components/chat/useSessions.ts`
- Test: `test/toUiMessages.test.ts`

- [ ] **Step 1: Write the failing test for the pure mapper**

Create `test/toUiMessages.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { toUiMessages } from "../src/sidepanel/components/chat/useSessions.ts";

describe("toUiMessages", () => {
  test("maps role/text and assigns positional ids", () => {
    const ui = toUiMessages([{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }], false);
    expect(ui).toEqual([
      { id: "0", role: "user", text: "hi", streaming: false },
      { id: "1", role: "assistant", text: "yo", streaming: false },
    ]);
  });

  test("marks only the last assistant message as streaming", () => {
    const ui = toUiMessages(
      [{ role: "user", text: "hi" }, { role: "assistant", text: "partial" }],
      true,
    );
    expect(ui[1]!.streaming).toBe(true);
    expect(ui[0]!.streaming).toBe(false);
  });

  test("does not mark a trailing user message as streaming", () => {
    const ui = toUiMessages([{ role: "assistant", text: "yo" }, { role: "user", text: "hi" }], true);
    expect(ui[1]!.streaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/toUiMessages.test.ts`
Expected: FAIL — cannot resolve the module / `toUiMessages` undefined.

- [ ] **Step 3: Implement the hook + mapper**

Create `src/sidepanel/components/chat/useSessions.ts`:

```ts
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
  return new SessionManager({
    conversations,
    messages,
    createSession: ({ providerSlug, modelId, initialMessages }) => {
      const models = listModels(providerSlug as KnownProvider);
      const model = models.find((x) => x.id === modelId) ?? models[0]!;
      return new ChatSession({ model, getToken: (p) => authStore.getToken(p), initialMessages });
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
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/toUiMessages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (The hook is exercised by typecheck + the App wiring in Task 9; no React render test — consistent with this repo's "logic in bun tests, UI in the playground" approach.)

- [ ] **Step 6: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/components/chat/useSessions.ts test/toUiMessages.test.ts
git commit -m "feat: useSessions hook + toUiMessages"
```

---

## Task 8: ConversationsDrawer + playground wiring

Presentational history panel, plus a `conversations` screen in the demo so it's verifiable via `bun dev` without loading the extension.

**Files:**
- Create: `src/sidepanel/components/chat/ConversationsDrawer.tsx`
- Modify: `src/demo/mock.ts`, `src/demo/preview.tsx`, `src/demo/Demo.tsx`

- [ ] **Step 1: Build the drawer component**

Create `src/sidepanel/components/chat/ConversationsDrawer.tsx`:

```tsx
/**
 * Slide-over history panel opened from the header's Conversations icon. Lists
 * stored conversations newest-first; supports open, delete, and starting a new
 * chat. Presentational — all data/handlers come from props (App wires the
 * SessionManager via useSessions).
 */
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/sessions/types";
import { Icon } from "./icons";
import { IconButton } from "./primitives";

export interface ConversationsDrawerProps {
  open: boolean;
  conversations: ConversationSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function ConversationsDrawer({
  open,
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
  onClose,
}: ConversationsDrawerProps) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close conversations"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      {/* Panel */}
      <div className="relative flex h-full w-72 max-w-[85%] flex-col border-r bg-background shadow-xl">
        <header className="flex items-center gap-1 border-b px-2 py-1.5">
          <span className="flex-1 px-1 text-sm font-semibold">Conversations</span>
          <IconButton icon="newChat" label="New chat" size="sm" className="rounded-full" onClick={onNewChat} />
          <IconButton icon="close" label="Close" size="sm" className="rounded-full" onClick={onClose} />
        </header>

        {conversations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
            No conversations yet. Your chats will show up here.
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto p-1.5">
            {conversations.map((c) => (
              <li key={c.id} className="group/item">
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent",
                    c.id === activeId && "bg-secondary",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left outline-none"
                  >
                    <span className="w-full truncate text-sm text-foreground">{c.title}</span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {c.origin && <span className="truncate">{c.origin}</span>}
                      {c.origin && <span aria-hidden>·</span>}
                      <span>{relativeTime(c.updatedAt)}</span>
                    </span>
                  </button>
                  <IconButton
                    icon="close"
                    label="Delete conversation"
                    size="sm"
                    className="rounded-full opacity-0 transition-opacity group-hover/item:opacity-100"
                    onClick={() => onDelete(c.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

> Note: `IconButton`, `Icon`, `cn` already exist (`primitives.tsx`, `icons.tsx`, `lib/utils`). The icon keys `newChat` and `close` are already in the ICONS registry (per `icons.tsx`). If `close` is missing at build time, add it to `ICONS` — but it is expected to be present.

- [ ] **Step 2: Add mock conversations for the playground**

In `src/demo/mock.ts`, add an import at the top (after the existing `ProviderEntry` import):

```ts
import type { ConversationSummary } from "@/lib/sessions/types";
```

and append at the end of the file:

```ts
/** Static history for the conversations-drawer demo screen. */
const HOUR = 3_600_000;
export const mockConversations: ConversationSummary[] = [
  { id: "c1", title: "Troubleshoot slow laptop", updatedAt: Date.now() - 5 * 60_000, origin: "support.example.com" },
  { id: "c2", title: "Summarize this page", updatedAt: Date.now() - 3 * HOUR, origin: "en.wikipedia.org" },
  { id: "c3", title: "Explain the selected code and suggest a cleaner approach", updatedAt: Date.now() - 26 * HOUR, origin: "github.com" },
  { id: "c4", title: "Draft a reply", updatedAt: Date.now() - 9 * 24 * HOUR },
];
```

- [ ] **Step 3: Render a conversations screen in the preview**

In `src/demo/preview.tsx`:

(a) Add imports near the existing component imports:

```ts
import { ConversationsDrawer } from "@/components/chat/ConversationsDrawer";
import { mockConversations } from "./mock";
```

(b) In `Root()`, add a branch before the final `return <ChatScreen />;`:

```tsx
  if (screen === "conversations") {
    return (
      <div className="relative h-full">
        <ChatScreen />
        <ConversationsDrawer
          open
          conversations={mockConversations}
          activeId="c1"
          onSelect={() => navTo("chat")}
          onDelete={() => {}}
          onNewChat={() => navTo("chat")}
          onClose={() => navTo("chat")}
        />
      </div>
    );
  }
```

- [ ] **Step 4: Add the screen to the demo control panel**

In `src/demo/Demo.tsx`, make two edits.

(a) Add `"conversations"` to the `Screen` union (line 9):

```ts
type Screen = "chat" | "onboarding" | "manage" | "conversations";
```

(b) Add an option to the Screen `Segment` (the `options` array around lines 35–39) so it reads:

```tsx
            options={[
              ["chat", "Chat"],
              ["onboarding", "Onboarding"],
              ["manage", "Manage"],
              ["conversations", "Conversations"],
            ]}
```

No other change is needed — `src` already interpolates `screen` into the iframe URL (`preview.html?screen=${screen}&…`), and `preview.tsx` (Step 3) handles `screen === "conversations"`.

- [ ] **Step 5: Typecheck + demo build**

Run: `bun run typecheck && bun run build:demo`
Expected: both succeed.

- [ ] **Step 6: Manual visual check**

Run: `bun dev` (starts the playground). In the control panel select **Screen → Conversations**, then exercise light/dark and the width slider (down to 280–300px). Confirm: list renders, titles truncate, timestamps read "5m ago / 3h ago / 1d ago / 1w ago", scrim closes, no horizontal overflow.

- [ ] **Step 7: Commit** *(only with user go-ahead)*

```bash
git add src/sidepanel/components/chat/ConversationsDrawer.tsx src/demo/mock.ts src/demo/preview.tsx src/demo/Demo.tsx
git commit -m "feat: ConversationsDrawer + playground screen"
```

---

## Task 9: Wire into the app + manifest + cleanup

Replace the ephemeral session with the persistent manager, mount the drawer, enable durable storage, and remove the superseded hook.

**Files:**
- Modify: `manifest.json`
- Modify: `src/sidepanel/App.tsx`
- Delete: `src/sidepanel/components/chat/useSessionView.ts`

- [ ] **Step 1: Enable durable storage**

In `manifest.json`, add `"unlimitedStorage"` to the `permissions` array:

```json
  "permissions": ["nativeMessaging", "tabs", "scripting", "activeTab", "sidePanel", "tabGroups", "storage", "unlimitedStorage"],
```

- [ ] **Step 2: Rewrite App to use useSessions + the drawer**

Replace the entire contents of `src/sidepanel/App.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import { ChatView } from "@/components/chat/ChatView";
import { ConversationsDrawer } from "@/components/chat/ConversationsDrawer";
import { ProvidersView, type ProviderEntry } from "@/components/chat/ProvidersView";
import { useSessions } from "@/components/chat/useSessions";
import { authStore } from "@/lib/authStore";
import { settingsStore } from "@/lib/settingsStore";
import { CURATED_PROVIDERS, getProviderMeta, listModels } from "@/lib/providers";
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  parseRedirect,
  refreshToken,
  type Pkce,
} from "@/lib/oauthAnthropic";
import type { KnownProvider } from "@earendil-works/pi-ai";

// Wire OAuth refresh into the shared auth store once.
authStore.setRefresher(refreshToken);

export function App() {
  const [connected, setConnected] = useState<string[] | undefined>();
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [providersOpen, setProvidersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Connect flow state (shared by the Providers view).
  const [pkce, setPkce] = useState<Pkce | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessions = useSessions();
  const started = useRef(false);

  async function reload() {
    const providers = await authStore.listProviders();
    setConnected(providers);
    const sel = await settingsStore.getSelection();
    if (sel.provider && providers.includes(sel.provider)) {
      setProvider(sel.provider);
      setModel(sel.model ?? listModels(sel.provider as KnownProvider)[0]?.id ?? "");
    } else if (providers[0]) {
      setProvider(providers[0]);
      setModel(listModels(providers[0] as KnownProvider)[0]?.id ?? "");
    } else {
      setProvider("");
      setModel("");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // Once a provider/model is available, start the first (draft) conversation.
  useEffect(() => {
    if (!started.current && provider && model) {
      started.current = true;
      sessions.newChat(provider, model);
    }
  }, [provider, model, sessions]);

  const providerEntries: ProviderEntry[] = CURATED_PROVIDERS.map((p) => ({
    slug: p.slug,
    name: p.name,
    connected: (connected ?? []).includes(p.slug),
    authMethods: p.authMethods,
    apiKeyUrl: p.apiKeyUrl,
  }));

  async function afterConnect(slug: string) {
    const m = listModels(slug as KnownProvider)[0]?.id ?? "";
    await settingsStore.setSelection(slug, m);
    setBusy(false);
    setError(null);
    setPkce(undefined);
    setProvidersOpen(false);
    await reload();
  }

  async function onConnectApiKey(slug: string, key: string) {
    if (!key) {
      setError("Enter an API key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authStore.setApiKey(slug, key);
      await afterConnect(slug);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onStartOAuth(_slug: string) {
    setError(null);
    const generated = await generatePkce();
    setPkce(generated);
    await chrome.tabs.create({ url: buildAuthorizeUrl(generated) });
  }

  async function onCompleteOAuth(slug: string, pastedText: string) {
    if (!pkce) {
      setError("Start the sign-in first.");
      return;
    }
    const { code, state } = parseRedirect(pastedText);
    if (!code) {
      setError("Could not find an authorization code in what you pasted.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cred = await exchangeCode({ code, state: state ?? pkce.verifier, verifier: pkce.verifier });
      await authStore.setOAuth(slug, cred);
      await afterConnect(slug);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDisconnect(slug: string) {
    await authStore.remove(slug);
    await reload();
  }

  if (connected === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  // No providers → onboarding; "Manage providers…" → manage. Same component.
  if (connected.length === 0 || providersOpen) {
    return (
      <ProvidersView
        providers={providerEntries}
        mode={connected.length === 0 ? "onboarding" : "manage"}
        busy={busy}
        error={error}
        onBack={
          connected.length === 0
            ? undefined
            : () => {
                setProvidersOpen(false);
                setError(null);
              }
        }
        onConnectApiKey={onConnectApiKey}
        onStartOAuth={onStartOAuth}
        onCompleteOAuth={onCompleteOAuth}
        onDisconnect={onDisconnect}
      />
    );
  }

  return (
    <div className="relative h-full">
      <ChatView
        providers={connected.map((slug) => ({ slug, name: getProviderMeta(slug)?.name ?? slug }))}
        models={listModels(provider as KnownProvider).map((m) => ({ id: m.id, name: m.name }))}
        provider={provider}
        model={model}
        messages={sessions.messages}
        streaming={sessions.streaming}
        error={sessions.error ?? undefined}
        onSelectProvider={async (p) => {
          const first = listModels(p as KnownProvider)[0]?.id ?? "";
          setProvider(p);
          setModel(first);
          await settingsStore.setSelection(p, first);
          sessions.setModel(p, first);
        }}
        onSelectModel={async (m) => {
          setModel(m);
          await settingsStore.setSelection(provider, m);
          sessions.setModel(provider, m);
        }}
        onSend={(text) => sessions.send(text)}
        onStop={() => sessions.stop()}
        onNewChat={() => sessions.newChat(provider, model)}
        onOpenConversations={() => setDrawerOpen(true)}
        onManageProviders={() => {
          setError(null);
          setProvidersOpen(true);
        }}
      />
      <ConversationsDrawer
        open={drawerOpen}
        conversations={sessions.conversations}
        activeId={sessions.activeId}
        onSelect={(id) => {
          void sessions.open(id).then((conv) => {
            if (conv) {
              setProvider(conv.provider);
              setModel(conv.model);
            }
            setDrawerOpen(false);
          });
        }}
        onDelete={(id) => sessions.remove(id)}
        onNewChat={() => {
          sessions.newChat(provider, model);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
```

Key changes vs the old App: removed the `useMemo` `ChatSession` + `useSessionView` + `epoch`; added `useSessions`, a one-shot bootstrap effect, the drawer, and routed provider/model changes through `sessions.setModel` (keeps the thread) instead of recreating a session.

- [ ] **Step 3: Delete the superseded hook**

```bash
rm src/sidepanel/components/chat/useSessionView.ts
```

- [ ] **Step 4: Verify nothing still imports it**

Run: `grep -rn "useSessionView" src test`
Expected: no matches.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Full test suite**

Run: `bun test`
Expected: all green (existing suite + idb, sessionsDb, sessionManager, time, toUiMessages, the new chat test; the live OpenRouter test stays skipped).

- [ ] **Step 7: Extension build + demo build**

Run: `bun run build && bun run build:demo`
Expected: both succeed.

- [ ] **Step 8: Manual end-to-end check (extension)**

Load the built extension in Chrome, connect a provider, send a couple of messages, click **New chat**, send again, then open the **Conversations** drawer (top-left icon). Confirm: both conversations are listed newest-first with titles from their first messages; clicking one reopens it with its full transcript; replies continue in that thread; delete removes it; reloading the side panel preserves history.

- [ ] **Step 9: Commit** *(only with user go-ahead)*

```bash
git add manifest.json src/sidepanel/App.tsx
git rm src/sidepanel/components/chat/useSessionView.ts
git commit -m "feat: persist chat history via SessionManager + conversations drawer"
```

---

## Completion

After Task 9, use **superpowers:finishing-a-development-branch** to verify tests and choose merge/PR/keep/discard.

---

## Self-Review (performed during planning)

**Coverage vs the approved design:**
- Domain-free storage helpers (KV kept + generic IndexedDB) → Tasks 1, 2. ✅
- IndexedDB + keep KV (decision) → Task 2 keeps `Kv`, adds `Database`/`Collection`. ✅
- Separate message records (Approach A) → Task 3 declares two stores; messages indexed by `conversationId`. ✅
- Flat list, store `origin` → `Conversation.origin` (Task 3); recorded in `send` (Task 5); shown in drawer (Task 8). ✅
- User-on-send / assistant-on-complete → `SessionManager.send` (Task 5) + the matching tests. ✅
- Auto-title from first message → `titleFrom` + tests (Task 5). ✅
- Rehydration → `ChatSession.initialMessages` (Task 4) + `open()` (Task 5) + test. ✅
- `unlimitedStorage` → Task 9. ✅
- Conversations drawer (declared in scope) → Tasks 8–9. ✅
- Error handling (persist failures swallowed, empty assistant skipped, aborted turn) → `persist()` wrapper + try/catch + empty-reply test (Task 5). ✅

**Type consistency:** `ChatSessionLike`, `ChatMessageView` (chat.ts) used identically by `SessionManager`, `useSessions`, and tests. `Conversation`/`StoredMessage`/`ConversationSummary` (sessions/types.ts) used consistently across db, manager, hook, drawer. `CreateSessionArgs` shared by manager + hook + test. `Collection<T>`/`Database`/`DatabaseSpec` names match across idb.ts, db.ts, and tests.

**Placeholder scan:** No TBD/TODO; every code step has complete code; every test step shows assertions and the exact run command + expected result.

**Known soft spots (acceptable for v1, called out so they aren't surprises):**
- The `useSessions` hook and `ConversationsDrawer`/`App` have no automated render tests (repo has no React test harness); their logic is pushed into the unit-tested `SessionManager`/`toUiMessages`/`relativeTime`, and the UI is verified via the playground + manual extension check.
- `setModel` persistence is fire-and-forget; the manager test flushes a microtask before asserting.
- Reopening syncs the header provider/model from the conversation; if that provider was later disconnected, the model list may differ — out of scope here.
