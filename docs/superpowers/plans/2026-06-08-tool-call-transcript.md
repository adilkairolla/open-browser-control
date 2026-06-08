# Tool Calls in the Chat Transcript — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each agent tool call inline in the chat transcript as a collapsed, expandable pill (per-tool icon + label + args summary + status), persist tool calls so reopened conversations show them, and thumbnail screenshot results.

**Architecture:** An ordered transcript-item model (`text` | `tool`) is built purely from pi agent state by `buildTranscript`. The agent's LLM history stays text-only (cheap); a separate rich transcript drives display, seeded from storage on reopen. Tool calls persist as additive `StoredMessage` rows (no DB migration). The view layer switches from `UiMessage[]` to a `UiItem[]` union, rendering tool items via a new `ToolCallCard`.

**Tech Stack:** React 19, Tailwind v4, base-ui, `@tanstack/react-virtual`, pi agent-core/ai, Bun + `bun:test` + happy-dom, hugeicons.

**Working directory for all commands:** `packages/extension`. File paths below are repo-root-relative.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/extension/src/sidepanel/lib/transcript.ts` | `TranscriptItem` types + pure `buildTranscript` | Create |
| `packages/extension/test/transcript.test.ts` | Tests for `buildTranscript` | Create |
| `packages/extension/src/sidepanel/components/chat/toolMeta.ts` | `TOOL_LABEL`, `TOOL_ICON`, `summarizeArgs`, `truncate` (pure) | Create |
| `packages/extension/test/toolMeta.test.ts` | Tests for `summarizeArgs` | Create |
| `packages/extension/src/sidepanel/components/chat/icons.tsx` | 7 new per-tool glyphs | Modify |
| `packages/extension/src/sidepanel/lib/chat.ts` | `getTranscript()`, `initialTranscript`, `ChatSessionLike` | Modify |
| `packages/extension/src/sidepanel/lib/sessions/types.ts` | `StoredMessage` tool fields | Modify |
| `packages/extension/src/sidepanel/lib/sessions/SessionManager.ts` | Persist + reconstruct tool rows | Modify |
| `packages/extension/test/sessionManager.test.ts` | Tool-persistence tests + FakeSession transcript | Modify |
| `packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx` | Collapsed/expandable tool pill | Create |
| `packages/extension/src/sidepanel/components/chat/types.ts` | `UiItem` union | Modify |
| `packages/extension/src/sidepanel/components/chat/useSessions.ts` | `toUiItems` | Modify |
| `packages/extension/test/toUiMessages.test.ts` → `toUiItems.test.ts` | `toUiItems` tests | Rename+rewrite |
| `packages/extension/src/sidepanel/components/chat/MessageList.tsx` | Render by `item.kind` | Modify |
| `packages/extension/src/sidepanel/App.tsx` | Remove transient "Running…" line | Modify |
| `packages/extension/src/demo/mock.ts` | `kind:"text"` items + tool sample | Modify |
| `packages/extension/src/demo/useDemoChat.ts` | `UiItem[]` | Modify |
| `packages/extension/src/demo/Demo.tsx` / `preview.tsx` | "Tools" demo state | Modify |

---

## Task 1: Transcript model + builder (`buildTranscript`)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/transcript.ts`
- Test: `packages/extension/test/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/transcript.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildTranscript } from "../src/sidepanel/lib/transcript.ts";

// Minimal stand-ins for pi AgentMessage shapes (only the fields buildTranscript reads).
const userMsg = (text: string) => ({ role: "user", content: text });
const asstText = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const asstTool = (id: string, name: string, args: Record<string, unknown>) => ({
  role: "assistant",
  content: [{ type: "toolCall", id, name, arguments: args }],
});
const toolResult = (toolCallId: string, text: string, isError = false) => ({
  role: "toolResult",
  toolCallId,
  toolName: "x",
  content: [{ type: "text", text }],
  isError,
});
const toolResultImage = (toolCallId: string, data: string) => ({
  role: "toolResult",
  toolCallId,
  toolName: "screenshot",
  content: [{ type: "image", data, mimeType: "image/png" }],
  isError: false,
});

describe("buildTranscript", () => {
  test("interleaves user text, assistant text, and tool calls in order", () => {
    const items = buildTranscript([
      userMsg("go to example"),
      asstTool("c1", "navigate", { url: "https://example.com" }),
      toolResult("c1", "navigated"),
      asstText("Done."),
    ] as any);
    expect(items.map((i) => i.kind)).toEqual(["text", "tool", "text"]);
    expect(items[0]).toMatchObject({ kind: "text", role: "user", text: "go to example" });
    expect(items[1]).toMatchObject({
      kind: "tool",
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
      status: "ok",
      result: { text: "navigated" },
    });
    expect(items[2]).toMatchObject({ kind: "text", role: "assistant", text: "Done." });
  });

  test("a tool call with no matching result is running", () => {
    const items = buildTranscript([asstTool("c1", "click", { ref: "e3" })] as any);
    expect(items[0]).toMatchObject({ kind: "tool", status: "running" });
    expect((items[0] as any).result).toBeUndefined();
  });

  test("an errored tool result is marked error with its text", () => {
    const items = buildTranscript([
      asstTool("c1", "click", { ref: "e9" }),
      toolResult("c1", "no such element", true),
    ] as any);
    expect(items[0]).toMatchObject({ kind: "tool", status: "error", error: "no such element" });
  });

  test("extracts an image result", () => {
    const items = buildTranscript([
      asstTool("c1", "screenshot", {}),
      toolResultImage("c1", "BASE64DATA"),
    ] as any);
    expect((items[0] as any).result.image).toEqual({ data: "BASE64DATA", mimeType: "image/png" });
  });

  test("appends the streaming message and skips empty text blocks", () => {
    const items = buildTranscript([userMsg("hi")] as any, asstText("partial") as any);
    expect(items.map((i) => i.kind)).toEqual(["text", "text"]);
    expect(items[1]).toMatchObject({ role: "assistant", text: "partial" });
  });

  test("assigns unique ids (text counter + toolCallId)", () => {
    const items = buildTranscript([userMsg("a"), asstTool("c1", "navigate", {}), asstText("b")] as any);
    expect(items.map((i) => i.id)).toEqual(["t0", "c1", "t1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/transcript.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/transcript.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/extension/src/sidepanel/lib/transcript.ts`:

```ts
/**
 * Ordered transcript-item model for the chat UI, built purely from pi agent
 * state. Replaces the lossy text-only view: emits a text item per non-empty
 * text block and a tool item per toolCall block, merging tool results by
 * toolCallId. Kept free of React/DOM so it is unit-tested directly.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type ToolStatus = "running" | "ok" | "error";

export interface ToolResultView {
  text?: string;
  image?: { data: string; mimeType: string };
}

export interface TranscriptText {
  kind: "text";
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface TranscriptTool {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: ToolResultView;
  error?: string;
}

export type TranscriptItem = TranscriptText | TranscriptTool;

type Content = string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

function joinText(content: Content): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

function firstImage(content: Content): { data: string; mimeType: string } | undefined {
  if (typeof content === "string") return undefined;
  const img = content.find((p) => p.type === "image" && typeof p.data === "string");
  return img ? { data: img.data as string, mimeType: img.mimeType ?? "image/png" } : undefined;
}

/** Flatten pi messages (+ the in-flight streaming message) into ordered items. */
export function buildTranscript(messages: AgentMessage[], streaming?: AgentMessage): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const byCallId = new Map<string, TranscriptTool>();
  let textN = 0;
  const all = streaming ? [...messages, streaming] : messages;

  for (const msg of all as any[]) {
    if (msg.role === "user") {
      const text = joinText(msg.content);
      if (text) items.push({ kind: "text", id: `t${textN++}`, role: "user", text });
    } else if (msg.role === "assistant") {
      for (const block of msg.content as any[]) {
        if (block.type === "text" && block.text) {
          items.push({ kind: "text", id: `t${textN++}`, role: "assistant", text: block.text });
        } else if (block.type === "toolCall") {
          const item: TranscriptTool = {
            kind: "tool",
            id: block.id,
            name: block.name,
            args: (block.arguments as Record<string, unknown>) ?? {},
            status: "running",
          };
          items.push(item);
          byCallId.set(block.id, item);
        }
      }
    } else if (msg.role === "toolResult") {
      const item = byCallId.get(msg.toolCallId);
      if (item) {
        const text = joinText(msg.content);
        const image = firstImage(msg.content);
        item.status = msg.isError ? "error" : "ok";
        item.result = { text: text || undefined, image };
        if (msg.isError) item.error = text || undefined;
      }
    }
  }
  return items;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/transcript.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/sidepanel/lib/transcript.ts packages/extension/test/transcript.test.ts
git commit -m "feat(extension): transcript-item model + buildTranscript"
```

---

## Task 2: Tool metadata (`toolMeta.ts`) + per-tool icons

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/icons.tsx`
- Create: `packages/extension/src/sidepanel/components/chat/toolMeta.ts`
- Test: `packages/extension/test/toolMeta.test.ts`

- [ ] **Step 1: Add the per-tool glyphs to `icons.tsx`**

In `packages/extension/src/sidepanel/components/chat/icons.tsx`, add these names to the import block from `@hugeicons/core-free-icons` (keep alphabetical-ish, just add them):

```tsx
  Camera01Icon,
  Cursor02Icon,
  HourglassIcon,
  KeyboardIcon,
  Layout01Icon,
  MouseScroll01Icon,
  TextFontIcon,
```

Then add these entries to the `ICONS` map (after `bulb: BulbIcon,`):

```tsx
  toolNavigate: Globe02Icon,
  toolRead: Layout01Icon,
  toolText: TextFontIcon,
  toolClick: Cursor02Icon,
  toolType: KeyboardIcon,
  toolScroll: MouseScroll01Icon,
  toolScreenshot: Camera01Icon,
  toolWait: HourglassIcon,
```

(`Globe02Icon` is already imported.)

- [ ] **Step 2: Write the failing test for `summarizeArgs`**

Create `packages/extension/test/toolMeta.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { summarizeArgs, TOOL_LABEL } from "../src/sidepanel/components/chat/toolMeta.ts";

describe("summarizeArgs", () => {
  test("navigate shows the url without protocol", () => {
    expect(summarizeArgs("navigate", { url: "https://example.com/path" })).toBe("example.com/path");
  });
  test("navigate shows the direction when there is no url", () => {
    expect(summarizeArgs("navigate", { direction: "back" })).toBe("back");
  });
  test("click shows the ref", () => {
    expect(summarizeArgs("click", { ref: "e3" })).toBe("e3");
  });
  test("type shows ref and a snippet", () => {
    expect(summarizeArgs("type", { ref: "e5", text: "hello world" })).toBe("e5: hello world");
  });
  test("scroll shows the direction", () => {
    expect(summarizeArgs("scroll", { direction: "down" })).toBe("down");
  });
  test("wait_for shows the selector or quoted text", () => {
    expect(summarizeArgs("wait_for", { selector: ".done" })).toBe(".done");
    expect(summarizeArgs("wait_for", { text: "Loaded" })).toBe('"Loaded"');
  });
  test("no-arg tools summarize to empty string", () => {
    expect(summarizeArgs("screenshot", {})).toBe("");
    expect(summarizeArgs("read_page", {})).toBe("");
  });
});

describe("TOOL_LABEL", () => {
  test("maps tool names to human labels", () => {
    expect(TOOL_LABEL.navigate).toBe("Navigate");
    expect(TOOL_LABEL.read_page).toBe("Read page");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test test/toolMeta.test.ts`
Expected: FAIL — cannot resolve `toolMeta.ts`.

- [ ] **Step 4: Write `toolMeta.ts`**

Create `packages/extension/src/sidepanel/components/chat/toolMeta.ts`:

```ts
/**
 * Presentation metadata for browser tool calls: human label, per-tool icon, and
 * a one-line args summary. Pure (no React) so summarizeArgs is unit-tested.
 */
import type { IconName } from "./icons";

export const TOOL_LABEL: Record<string, string> = {
  navigate: "Navigate",
  read_page: "Read page",
  get_page_text: "Read text",
  click: "Click",
  type: "Type",
  scroll: "Scroll",
  screenshot: "Screenshot",
  wait_for: "Wait for",
};

export const TOOL_ICON: Record<string, IconName> = {
  navigate: "toolNavigate",
  read_page: "toolRead",
  get_page_text: "toolText",
  click: "toolClick",
  type: "toolType",
  scroll: "toolScroll",
  screenshot: "toolScreenshot",
  wait_for: "toolWait",
};

/** Clip a string to `max` chars with a trailing ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A compact, human one-liner for a tool call's arguments (label shown separately). */
export function summarizeArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "navigate":
      return args.url ? stripProtocol(str(args.url)) : str(args.direction);
    case "click":
      return str(args.ref);
    case "type": {
      const ref = str(args.ref);
      const text = truncate(str(args.text), 40);
      return ref && text ? `${ref}: ${text}` : ref || text;
    }
    case "scroll":
      return str(args.direction);
    case "wait_for":
      return args.selector ? str(args.selector) : args.text ? `"${str(args.text)}"` : "";
    default:
      return "";
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/toolMeta.test.ts && bun run typecheck`
Expected: PASS (9 tests); typecheck clean (the new `IconName` values exist after Step 1).

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/icons.tsx packages/extension/src/sidepanel/components/chat/toolMeta.ts packages/extension/test/toolMeta.test.ts
git commit -m "feat(extension): per-tool icons + tool metadata/summarizeArgs"
```

---

## Task 3: `ChatSession.getTranscript()` + `initialTranscript`

**Files:**
- Modify: `packages/extension/src/sidepanel/lib/chat.ts`
- Modify: `packages/extension/test/sessionManager.test.ts` (FakeSession must satisfy the interface)

- [ ] **Step 1: Import the transcript model in `chat.ts`**

At the top of `packages/extension/src/sidepanel/lib/chat.ts`, add after the existing imports:

```ts
import { buildTranscript, type TranscriptItem } from "./transcript";
```

- [ ] **Step 2: Add `initialTranscript` to options and `getTranscript` to the interface**

In `ChatSessionOptions` (the `export interface ChatSessionOptions { ... }`), add:

```ts
  /** Rich display transcript (text + tool items) to seed the UI on reopen. */
  initialTranscript?: TranscriptItem[];
```

In `ChatSessionLike` (the `export interface ChatSessionLike { ... }`), add a line after `getMessages(): ChatMessageView[];`:

```ts
  getTranscript(): TranscriptItem[];
```

- [ ] **Step 3: Store the seed + count in the constructor**

In the `ChatSession` class, add two private fields near the other `private readonly` fields:

```ts
  private readonly seededTranscript: TranscriptItem[];
  private readonly seedCount: number;
```

In the constructor body (before or after `this.agent = new Agent({ ... })`), add:

```ts
    this.seededTranscript = options.initialTranscript ?? [];
    this.seedCount = (options.initialMessages ?? []).length;
```

- [ ] **Step 4: Implement `getTranscript`**

Add this method to the `ChatSession` class (next to `getMessages`):

```ts
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
```

- [ ] **Step 5: Add `getTranscript` to the test FakeSession**

In `packages/extension/test/sessionManager.test.ts`, the `FakeSession` class implements `ChatSessionLike`. Add an import at the top:

```ts
import type { TranscriptItem } from "../src/sidepanel/lib/transcript.ts";
```

Add this method to `FakeSession` (after `getMessages()`):

```ts
  getTranscript(): TranscriptItem[] {
    return this.msgs.map((m, i) => ({ kind: "text", id: `t${i}`, role: m.role, text: m.text }));
  }
```

- [ ] **Step 6: Verify typecheck + existing tests**

Run: `bun run typecheck && bun test`
Expected: typecheck clean; all existing tests PASS (108+).

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/sidepanel/lib/chat.ts packages/extension/test/sessionManager.test.ts
git commit -m "feat(extension): ChatSession.getTranscript + initialTranscript seed"
```

---

## Task 4: Persist + reconstruct tool calls (`SessionManager`)

**Files:**
- Modify: `packages/extension/src/sidepanel/lib/sessions/types.ts`
- Modify: `packages/extension/src/sidepanel/lib/sessions/SessionManager.ts`
- Modify: `packages/extension/test/sessionManager.test.ts`

- [ ] **Step 1: Extend `StoredMessage`**

In `packages/extension/src/sidepanel/lib/sessions/types.ts`, replace the `StoredMessage` interface with:

```ts
export interface StoredMessage {
  id: string;
  conversationId: string;
  role: StoredRole;
  /** Discriminates a text row from a tool-call row; absent ⇒ "text" (legacy rows). */
  kind?: "text" | "tool";
  /** Text rows. */
  text?: string;
  /** Tool rows: */
  toolName?: string;
  argsJson?: string;
  status?: "ok" | "error";
  resultText?: string;
  resultImageData?: string;
  resultImageMime?: string;
  /** Monotonic order within a conversation (0, 1, 2 …). */
  seq: number;
  createdAt: number;
}
```

- [ ] **Step 2: Write failing tests for tool persistence + reconstruction**

In `packages/extension/test/sessionManager.test.ts`, first extend `FakeSession` so a turn can include tool items. Add a field and replace its `getTranscript`:

Add near the other fields (e.g. after `reply = "ok";`):

```ts
  toolCalls: { name: string; args: Record<string, unknown>; status: "ok" | "error"; resultText?: string; resultImageData?: string }[] = [];
```

Replace the `getTranscript()` you added in Task 3 with one that appends tool items after the user turn:

```ts
  getTranscript(): TranscriptItem[] {
    const items: TranscriptItem[] = this.msgs.map((m, i) => ({
      kind: "text" as const,
      id: `t${i}`,
      role: m.role,
      text: m.text,
    }));
    // Insert tool items just before the trailing assistant reply (if any).
    const tools: TranscriptItem[] = this.toolCalls.map((t, i) => ({
      kind: "tool" as const,
      id: `call${i}`,
      name: t.name,
      args: t.args,
      status: t.status,
      result: {
        text: t.resultText,
        image: t.resultImageData ? { data: t.resultImageData, mimeType: "image/png" } : undefined,
      },
      error: t.status === "error" ? t.resultText : undefined,
    }));
    if (tools.length === 0) return items;
    const lastAssistant = items.length && items[items.length - 1]!.role === "assistant";
    return lastAssistant ? [...items.slice(0, -1), ...tools, items[items.length - 1]!] : [...items, ...tools];
  }
```

Then add these tests inside the `describe("SessionManager", ...)` block:

```ts
  test("persists tool-call rows from the turn, with finalized status", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    h.getLast()!.toolCalls = [
      { name: "navigate", args: { url: "https://example.com" }, status: "ok", resultText: "navigated" },
    ];
    await h.mgr.send("go to example");

    const conv = (await h.conversations.getAll())[0]!;
    const msgs = (await h.messages.getAllByIndex("conversationId", conv.id)).sort((a, b) => a.seq - b.seq);
    expect(msgs.map((m) => m.kind ?? "text")).toEqual(["text", "tool", "text"]);
    const tool = msgs.find((m) => m.kind === "tool")!;
    expect(tool.toolName).toBe("navigate");
    expect(JSON.parse(tool.argsJson!)).toEqual({ url: "https://example.com" });
    expect(tool.status).toBe("ok");
    expect(tool.resultText).toBe("navigated");
  });

  test("reopen reconstructs tool items for display but seeds the agent text-only", async () => {
    await h.mgr.init();
    h.mgr.startNew("openrouter", "m1");
    h.getLast()!.toolCalls = [{ name: "click", args: { ref: "e3" }, status: "ok", resultText: "clicked" }];
    await h.mgr.send("click it");
    const conv = (await h.conversations.getAll())[0]!;

    await h.mgr.open(conv.id);
    const seed = h.created[h.created.length - 1]!;
    // Agent seed is text-only (user + assistant), no tool rows.
    expect(seed.initialMessages!.map((m) => m.role)).toEqual(["user", "assistant"]);
    // Display seed includes the tool item.
    expect(seed.initialTranscript!.map((i) => i.kind)).toEqual(["text", "tool", "text"]);
    expect(seed.initialTranscript!.find((i) => i.kind === "tool")).toMatchObject({
      name: "click",
      args: { ref: "e3" },
      status: "ok",
    });
  });
```

Note: `CreateSessionArgs` needs an `initialTranscript` field for `seed.initialTranscript` to typecheck — added in Step 3.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test test/sessionManager.test.ts`
Expected: FAIL — `initialTranscript` not on `CreateSessionArgs`, and tool rows not persisted.

- [ ] **Step 4: Thread `initialTranscript` through `CreateSessionArgs`**

In `packages/extension/src/sidepanel/lib/sessions/SessionManager.ts`, add the import:

```ts
import type { TranscriptItem } from "../transcript.ts";
```

Add the field to `CreateSessionArgs`:

```ts
export interface CreateSessionArgs {
  providerSlug: string;
  modelId: string;
  initialMessages?: ChatMessageView[];
  initialTranscript?: TranscriptItem[];
}
```

Update `setActive`'s signature and the `createSession` call so it forwards a transcript. Change the `setActive` parameter list to add `initialTranscript`:

```ts
  private setActive(
    providerSlug: string,
    modelId: string,
    conversation: Conversation | undefined,
    initialMessages: ChatMessageView[] | undefined,
    initialTranscript: TranscriptItem[] | undefined,
    seq: number,
  ): void {
    this.active?.session.abort();
    this.active?.unsubscribe();
    const session = this.createSession({ providerSlug, modelId, initialMessages, initialTranscript });
    const unsubscribe = session.subscribe(() => this.emit());
    this.active = { conversation, providerSlug, modelId, session, seq, unsubscribe };
    this.emit();
  }
```

Update the three `setActive(...)` callers to pass the new arg:
- In `startNew`: `this.setActive(providerSlug, modelId, undefined, undefined, undefined, 0);`
- In `open` (see Step 6 for the full body).
- In `setModel`: `this.setActive(providerSlug, modelId, conversation, clean, a.session.getTranscript(), a.seq);`

- [ ] **Step 5: Persist all new transcript items in `send()`**

In `SessionManager.send()`, replace the block that currently persists only the final assistant reply — from the comment `// Snapshot the transcript length...` through the `if (assistant && assistant.text.trim()) { ... }` block — with this (keep the user-message persistence above it unchanged, and the `a.conversation.updatedAt` lines below it unchanged):

```ts
      // Snapshot the transcript length so we persist only items produced by THIS
      // turn (the leading item is the user message, already persisted above).
      const before = a.session.getTranscript().length;

      // Run the turn; resolves when streaming completes (or is aborted).
      try {
        await a.session.send(body);
      } catch (e) {
        console.error("[sessions] turn failed", e);
      }

      // The active conversation may have been deleted or switched mid-turn.
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
          const seq = a.seq++;
          await this.persist(() =>
            this.messages.put({
              id: this.newId(),
              conversationId: convId,
              role: "assistant",
              kind: "tool",
              toolName: item.name,
              argsJson: JSON.stringify(item.args ?? {}),
              status: item.status,
              resultText: item.result?.text,
              resultImageData: item.result?.image?.data,
              resultImageMime: item.result?.image?.mimeType,
              seq,
              createdAt: this.now(),
            }),
          );
        }
      }
```

- [ ] **Step 6: Reconstruct both seeds in `open()`**

In `SessionManager.open()`, replace the body from the `const views: ChatMessageView[] = ...` line through the `this.setActive(...)` call with:

```ts
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
```

- [ ] **Step 7: Run the tests**

Run: `bun test test/sessionManager.test.ts && bun run typecheck`
Expected: PASS — existing SessionManager tests still pass (text-only turns persist `["user","assistant"]` rows with no `kind`/`kind:"text"`), plus the two new tool tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/extension/src/sidepanel/lib/sessions/types.ts packages/extension/src/sidepanel/lib/sessions/SessionManager.ts packages/extension/test/sessionManager.test.ts
git commit -m "feat(extension): persist + reconstruct tool calls in conversation history"
```

---

## Task 5: `ToolCallCard` component

**Files:**
- Create: `packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx`

This task references `UiToolCall` from `./types`, which is added in Task 6. To keep this task self-contained and compiling, define the prop type inline here and switch `MessageList` to it in Task 6 (the shape matches `UiToolCall` exactly).

- [ ] **Step 1: Create the component**

Create `packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx`:

```tsx
/**
 * One tool call in the transcript: a collapsed pill (per-tool icon, label, args
 * summary, status) that expands to raw args + result. Screenshot results render
 * as an inline thumbnail. Expansion is local; the virtualizer re-measures on
 * toggle via its ResizeObserver.
 */
import { useState } from "react";
import { Icon } from "./icons";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { TOOL_ICON, TOOL_LABEL, summarizeArgs, truncate } from "./toolMeta";

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  result?: { text?: string; image?: { data: string; mimeType: string } };
  error?: string;
}

function StatusIcon({ status }: { status: ToolCallView["status"] }) {
  if (status === "running") return <Spinner className="size-3.5 text-muted-foreground" />;
  if (status === "error") return <Icon name="close" size={14} className="text-destructive" />;
  return <Icon name="check" size={14} className="text-success" />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export function ToolCallCard({ tool }: { tool: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[tool.name] ?? tool.name;
  const icon = TOOL_ICON[tool.name] ?? "settings";
  const summary = summarizeArgs(tool.name, tool.args);

  return (
    <div className="rounded-xl border bg-card/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name={icon} size={14} className="text-muted-foreground" />
        <span className="font-medium">{label}</span>
        {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusIcon status={tool.status} />
          <Icon
            name="chevronDown"
            size={12}
            className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t px-2.5 py-2">
          <Field label="args">
            <pre className="overflow-x-auto rounded bg-secondary p-2 font-mono text-[11px] leading-snug">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </Field>
          {tool.error && (
            <Field label="error">
              <span className="text-destructive">{tool.error}</span>
            </Field>
          )}
          {tool.result?.text && !tool.error && (
            <Field label="result">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2 font-mono text-[11px] leading-snug">
                {truncate(tool.result.text, 2000)}
              </pre>
            </Field>
          )}
          {tool.result?.image && (
            <Field label="screenshot">
              <img
                src={`data:${tool.result.image.mimeType};base64,${tool.result.image.data}`}
                alt="screenshot result"
                className="max-h-48 w-auto rounded border"
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx
git commit -m "feat(extension): ToolCallCard tool-call pill"
```

---

## Task 6: View-model migration to `UiItem` + render tool cards

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/types.ts`
- Modify: `packages/extension/src/sidepanel/components/chat/useSessions.ts`
- Rename+rewrite: `packages/extension/test/toUiMessages.test.ts` → `packages/extension/test/toUiItems.test.ts`
- Modify: `packages/extension/src/sidepanel/components/chat/MessageList.tsx`
- Modify: `packages/extension/src/sidepanel/App.tsx`
- Modify: `packages/extension/src/demo/mock.ts`, `packages/extension/src/demo/useDemoChat.ts`

- [ ] **Step 1: Define the `UiItem` union in `types.ts`**

In `packages/extension/src/sidepanel/components/chat/types.ts`, replace the `UiMessage` interface with:

```ts
export interface UiTextMessage {
  kind: "text";
  id: string;
  role: ChatRole;
  text: string;
  /** True for the in-flight assistant reply currently being streamed. */
  streaming?: boolean;
}

export interface UiToolCall {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  result?: { text?: string; image?: { data: string; mimeType: string } };
  error?: string;
}

export type UiItem = UiTextMessage | UiToolCall;
```

Then change `ChatViewProps.messages` from `messages: UiMessage[];` to:

```ts
  messages: UiItem[];
```

- [ ] **Step 2: Write the failing `toUiItems` test**

First remove the obsolete test (it imports the now-replaced `toUiMessages`, so it must go before Step 7 runs the suite):

```bash
rm packages/extension/test/toUiMessages.test.ts
```

Then create `packages/extension/test/toUiItems.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { toUiItems } from "../src/sidepanel/components/chat/useSessions.ts";
import type { TranscriptItem } from "../src/sidepanel/lib/transcript.ts";

const T = (role: "user" | "assistant", text: string, id: string): TranscriptItem => ({
  kind: "text",
  id,
  role,
  text,
});

describe("toUiItems", () => {
  test("passes through text items and assigns streaming to the last assistant text", () => {
    const ui = toUiItems([T("user", "hi", "t0"), T("assistant", "yo", "t1")], true);
    expect(ui[0]).toEqual({ kind: "text", id: "t0", role: "user", text: "hi", streaming: false });
    expect(ui[1]).toEqual({ kind: "text", id: "t1", role: "assistant", text: "yo", streaming: true });
  });

  test("does not mark anything streaming when not streaming", () => {
    const ui = toUiItems([T("assistant", "yo", "t0")], false);
    expect((ui[0] as any).streaming).toBe(false);
  });

  test("passes tool items through unchanged", () => {
    const tool: TranscriptItem = {
      kind: "tool",
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
      status: "ok",
      result: { text: "navigated" },
    };
    const ui = toUiItems([tool], false);
    expect(ui[0]).toEqual({
      kind: "tool",
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
      status: "ok",
      result: { text: "navigated" },
      error: undefined,
    });
  });
});
```

Run: `bun test test/toUiItems.test.ts`
Expected: FAIL — `toUiItems` not exported yet.

- [ ] **Step 3: Replace `toUiMessages` with `toUiItems` in `useSessions.ts`**

In `packages/extension/src/sidepanel/components/chat/useSessions.ts`:

Change the type import line `import type { UiMessage } from "./types";` to:

```ts
import type { UiItem } from "./types";
import type { TranscriptItem } from "@/lib/transcript";
```

Replace the `toUiMessages` function with:

```ts
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
```

Change the `messages` derivation (currently `const messages = session ? toUiMessages(session.getMessages(), streaming) : [];`) to:

```ts
  const messages = session ? toUiItems(session.getTranscript(), streaming) : [];
```

Change the `UseSessions` interface field `messages: UiMessage[];` to `messages: UiItem[];`.

- [ ] **Step 4: Render by `item.kind` in `MessageList.tsx`**

In `packages/extension/src/sidepanel/components/chat/MessageList.tsx`:

Change the imports: replace `import type { UiMessage } from "./types";` with:

```ts
import type { UiItem } from "./types";
import { ToolCallCard } from "./ToolCallCard";
```

Change the component signature from `{ messages: UiMessage[]; streaming: boolean }` to `{ messages: UiItem[]; streaming: boolean }`.

Replace the row body (the `{m.role === "user" ? ( ... ) : ( ... )}` block inside the mapped row) with a `kind` switch:

```tsx
                  {m.kind === "tool" ? (
                    <ToolCallCard tool={m} />
                  ) : m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className={cn(WRAP, "max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-sm")}>
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div className="group">
                      <Markdown text={m.text} streaming={!!m.streaming} />
                      {!m.streaming && m.text && (
                        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <MessageActions text={m.text} />
                        </div>
                      )}
                    </div>
                  )}
```

(`ToolCallCard`'s `ToolCallView` prop shape matches `UiToolCall`, so `tool={m}` typechecks when `m.kind === "tool"`.)

- [ ] **Step 5: Remove the transient "Running…" line in `App.tsx`**

In `packages/extension/src/sidepanel/App.tsx`, in the `composerTop` prop, remove the activeTool line so it becomes:

```tsx
        composerTop={
          <>
            {perms.pending && <ToolApprovalCard pending={perms.pending} onDecide={perms.resolve} />}
          </>
        }
```

(Delete the `{sessions.activeTool && ( ... Running ... )}` block. Leave `useSessions`/`activeTool` as-is — the page-glow path still uses the session events; `activeTool` simply goes unused here.)

- [ ] **Step 6: Migrate the demo to `UiItem[]`**

In `packages/extension/src/demo/mock.ts`:
- Change the import `import type { UiMessage, UiModel, UiProvider } from "@/components/chat/types";` to `import type { UiItem, UiModel, UiProvider } from "@/components/chat/types";`.
- Change `sampleConversation`'s type to `UiItem[]` and add `kind: "text"` to each of its four entries (e.g. `{ id: "m1", kind: "text", role: "user", text: "..." }`).
- Change `longConversation`'s type annotation to `UiItem[]` and its arrow return type from `: UiMessage` to `: UiItem`, and add `kind: "text" as const` to both returned objects.

In `packages/extension/src/demo/useDemoChat.ts`:
- Change `import type { ChatViewProps, UiMessage } from "@/components/chat/types";` to `import type { ChatViewProps, UiItem } from "@/components/chat/types";`.
- Change `useDemoChat(initial: UiMessage[])` to `useDemoChat(initial: UiItem[])` and `useState<UiMessage[]>(initial)` to `useState<UiItem[]>(initial)`.
- In `send`, change the two object literals to include `kind: "text"`: the user message `{ id: nextId(), kind: "text", role: "user", text }` and the assistant placeholder `{ id: assistantId, kind: "text", role: "assistant", text: "", streaming: true }`.
- Guard **all four** `.map(...)` updates with `m.kind === "text"` so they typecheck against the `UiItem` union (the spread/`.streaming`/`.text` accesses are only valid on text items). Replace each as follows:
  - In `stop`: `setMessages((ms) => ms.map((m) => (m.kind === "text" && m.streaming ? { ...m, streaming: false } : m)));`
  - In `send`'s interval tick: `setMessages((ms) => ms.map((m) => (m.kind === "text" && m.id === assistantId ? { ...m, text: slice } : m)));`
  - In `send`'s interval-end branch: `setMessages((ms) => ms.map((m) => (m.kind === "text" && m.id === assistantId ? { ...m, streaming: false } : m)));`
  - (The `setMessages((ms) => [...ms, userMsg, {...}])` append in `send` needs no guard — just the `kind: "text"` additions above.)

- [ ] **Step 7: Run tests + typecheck**

Run: `bun test && bun run typecheck`
Expected: all PASS, typecheck clean. (`toUiItems.test.ts` passes; the old `toUiMessages.test.ts` is gone.)

- [ ] **Step 8: Commit**

```bash
# `git add` on the deleted path stages its removal (records the rename).
git add packages/extension/test/toUiMessages.test.ts packages/extension/test/toUiItems.test.ts \
  packages/extension/src/sidepanel/components/chat/types.ts packages/extension/src/sidepanel/components/chat/useSessions.ts packages/extension/src/sidepanel/components/chat/MessageList.tsx packages/extension/src/sidepanel/App.tsx packages/extension/src/demo/mock.ts packages/extension/src/demo/useDemoChat.ts
git commit -m "feat(extension): render tool calls in transcript via UiItem model"
```

---

## Task 7: Demo tool sample + "Tools" state

**Files:**
- Modify: `packages/extension/src/demo/mock.ts`
- Modify: `packages/extension/src/demo/Demo.tsx`
- Modify: `packages/extension/src/demo/preview.tsx`

- [ ] **Step 1: Add a tool-showcase conversation to `mock.ts`**

Append to `packages/extension/src/demo/mock.ts` (after `longConversation`):

```ts
/** A tiny 1x1 PNG (transparent) so the screenshot thumbnail has something to show. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Showcases tool pills (ok / error / running / screenshot) in the playground. */
export const toolConversation: UiItem[] = [
  { id: "tc-u1", kind: "text", role: "user", text: "Open example.com and screenshot it." },
  { id: "tc-t1", kind: "tool", name: "navigate", args: { url: "https://example.com" }, status: "ok", result: { text: "Navigated. Call read_page to see the page." } },
  { id: "tc-t2", kind: "tool", name: "read_page", args: { interactiveOnly: true }, status: "ok", result: { text: '[e1] link "More information"\n[e2] heading "Example Domain"' } },
  { id: "tc-t3", kind: "tool", name: "screenshot", args: {}, status: "ok", result: { image: { data: TINY_PNG, mimeType: "image/png" } } },
  { id: "tc-t4", kind: "tool", name: "click", args: { ref: "e9" }, status: "error", error: "No element with ref e9 (refs go stale after navigation)." },
  { id: "tc-a1", kind: "text", role: "assistant", text: "Here's **example.com** — captured a screenshot. The stale-ref click failed; I'd re-read the page first." },
];
```

- [ ] **Step 2: Add the "Tools" state to the playground**

In `packages/extension/src/demo/Demo.tsx`, change the `State` type to:

```tsx
type State = "empty" | "chat" | "long" | "tools";
```

And add the option to the State `Segment`:

```tsx
                ["long", "Long (virtualized)"],
                ["tools", "Tool calls"],
```

- [ ] **Step 3: Seed the tools conversation in `preview.tsx`**

In `packages/extension/src/demo/preview.tsx`, update the mock import to include `toolConversation`:

```tsx
import { longConversation, mockConversations, providerEntries, sampleConversation, toolConversation } from "./mock";
```

Change `ChatScreen`'s `initial` line to:

```tsx
  const initial =
    state === "tools"
      ? toolConversation
      : state === "long"
        ? longConversation
        : state === "chat"
          ? sampleConversation
          : [];
```

- [ ] **Step 4: Typecheck + visual verification**

Run: `bun run typecheck` (expect clean), then `bun run dev` and open the printed URL. Check:
- **State = Tool calls:** each tool renders as a collapsed pill with its per-tool icon, label, and args summary; status shows ✓ (success), ✕ (error, destructive), and the running spinner if present. Click a pill → expands to show args JSON; the `read_page` result shows truncated/scrollable text; the `screenshot` row shows an inline thumbnail; the errored `click` shows its error in destructive color.
- **State = Conversation / Long:** still render correctly (text + markdown), and expanding a tool card re-measures without overlap (scroll past it).
- Toggle **Theme = Dark** and confirm the pills/borders read well.

Stop the dev server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/demo/mock.ts packages/extension/src/demo/Demo.tsx packages/extension/src/demo/preview.tsx
git commit -m "demo: tool-call showcase state"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full suite**

Run:

```bash
bun test && bun run typecheck && bun run build
```

Expected: all tests PASS, typecheck clean, build succeeds.

- [ ] **Step 2: Confirm against the spec**
  - Ordered transcript-item model built from agent state ✅ (Task 1)
  - Per-tool icons + label + args summary ✅ (Task 2)
  - Display vs. text-only LLM seed separated ✅ (Task 3)
  - Tool calls persist + reopen reconstructs them ✅ (Task 4)
  - Collapsed/expandable pill, status, screenshot thumbnail ✅ (Tasks 5, 7)
  - `UiItem` view model + inline rendering, transient line removed ✅ (Task 6)

---

## Notes / gotchas

- **`verbatimModuleSyntax` is on** → type-only imports use `import type` (followed throughout).
- **Each task stays green:** `getTranscript` is added to `ChatSessionLike` (Task 3) with the FakeSession satisfying it before SessionManager starts consuming it (Task 4); `ToolCallCard` (Task 5) is built before `MessageList` references it (Task 6).
- **Image data is raw base64** (no `data:` prefix) in `ToolContent`/storage; the card builds the `data:` URL.
- **`seedCount` assumes the agent doesn't rewrite history** — true for this setup (no `transformContext`/`convertToLlm`). If compaction is added later, revisit the slice boundary.
- **Screenshot storage** can grow IndexedDB; acceptable for now (`unlimitedStorage`), a size cap is a possible follow-up.
- The playground (web CSP) renders Shiki/markdown fine; tool pills are pure DOM, no CSP concern.
