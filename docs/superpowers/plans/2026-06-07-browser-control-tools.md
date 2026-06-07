# Browser-Control Tools, Service-Worker Executors & Permission Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the in-panel chat agent actually drive the active browser tab — navigate, read the page, click, type, scroll, screenshot, wait — through service-worker executors, gated by a two-mode permission guard (`yolo` = auto-approve, `ask` = confirm mutating actions, remembered per site).

**Architecture:** The pi `Agent` (sidepanel) is given 8 `AgentTool`s whose `execute` sends a one-shot message to the service worker. The SW resolves the active tab and dispatches to an executor. Page-perception tools (`read_page`, `get_page_text`, `wait_for`) run via `chrome.scripting.executeScript` with self-contained injected functions; input tools (`click`, `type`, `scroll`) use CDP (`chrome.debugger` → `Input.*`); `screenshot` uses `chrome.tabs.captureVisibleTab`; `navigate` uses `chrome.tabs.update`. The permission guard is pi's `beforeToolCall` hook, implemented as a `PermissionController` in the sidepanel that auto-allows reads, auto-allows everything in `yolo`, and otherwise surfaces an inline approval card and `await`s the user. The same SW executor layer is reused later by the MCP/native-host path — nothing here is throwaway.

**Tech Stack:** TypeScript 6 strict, Chrome MV3 (`chrome.scripting`, `chrome.debugger`, `chrome.tabs`), `@earendil-works/pi-agent-core` + `pi-ai` (`AgentTool`, `beforeToolCall`, TypeBox via `Type` re-exported from pi-ai), React 19, Tailwind v4, `bun test`, `happy-dom` for DOM unit tests, Vite + `vite-plugin-web-extension`.

---

## Pre-flight (read before starting)

- **Work dir:** `/Users/nosferatu/Projects/personal/open-browser-control/packages/extension`. Repo is a Bun workspace; **not a git repo per the harness** — committing is the user's call; do NOT commit/push unless asked. The "Commit" steps below are written as the user would run them; treat them as checkpoints and skip the actual `git` call unless the user has asked for commits.
- **Commands:** tests `bun test` (from `packages/extension`); types `bun run typecheck`; build `bun run build`; demo build `bun run build:demo`. There is no `npm test`.
- **`.var/` is read-only reference** (pi clone at `.var/pi`, reference extension at `.var/1.0.75_0`). Never modify it.
- **Confirmed API facts** (do not re-derive):
  - `import { Type } from "@earendil-works/pi-ai"` and `import type { Static, TSchema, TextContent, ImageContent } from "@earendil-works/pi-ai"` — pi-ai re-exports TypeBox. No new `typebox` dependency needed.
  - `import type { AgentTool, AgentToolResult, BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core"`.
  - `AgentTool` = `{ name; description; label; parameters: TSchema; execute(toolCallId, params, signal?, onUpdate?): Promise<AgentToolResult>; prepareArguments?; executionMode? }`.
  - `AgentToolResult<T>` = `{ content: (TextContent | ImageContent)[]; details: T; terminate? }`.
  - `BeforeToolCallContext` = `{ assistantMessage; toolCall: AgentToolCall; args: unknown; context }`; `toolCall.name` is the tool name.
  - `BeforeToolCallResult` = `{ block?: boolean; reason?: string }`. Return `{ block: true, reason }` to deny (model gets a clean error tool result).
  - `beforeToolCall` is a **top-level** `Agent` constructor option (`new Agent({ initialState:{tools}, getApiKey, beforeToolCall })`).
  - `chrome.scripting.executeScript({target:{tabId}, func, args})` returns `InjectionResult[]`; read `[0].result`. **The `func` must be fully self-contained** — no module-scope/imported references, all helpers nested inside — because Chrome serializes it via `.toString()`.
  - `TextContent` = `{type:"text"; text:string}`; `ImageContent` = `{type:"image"; data:string; mimeType:string}`.
  - `Kv` stores values **as-is** (not stringified): `get(key):Promise<unknown>`, `set(key, value:unknown)`.

---

## File Structure

**Service-worker / shared (new top-level `src/control/`):**
- `src/control/protocol.ts` — in-extension SW↔sidepanel message + result types (distinct from `@obc/shared` native-messaging wire).
- `src/control/inject/page-fns.ts` — self-contained functions injected into pages (a11y tree, ref rect, focus, page text, wait). **Tested.**
- `src/control/cdp.ts` — `chrome.debugger` attach/send with idle auto-detach.
- `src/control/tabs.ts` — `resolveActiveTab()`.
- `src/control/executors.ts` — the 8 executors `(args, tabId) => Promise<ToolExecResult>` + a `dispatch()` map.
- `src/background.ts` — **modify**: add the `OBC_TOOL_EXEC` `onMessage` dispatcher.

**Sidepanel:**
- `src/sidepanel/lib/tools/client.ts` — `execTool()` over `chrome.runtime.sendMessage`. **Tested.**
- `src/sidepanel/lib/tools/browserTools.ts` — `createBrowserTools()` + `MUTATING_TOOLS`. **Tested.**
- `src/sidepanel/lib/permissions/store.ts` — `PermissionStore` over `Kv`. **Tested.**
- `src/sidepanel/lib/permissions/PermissionController.ts` — the guard. **Tested.**
- `src/sidepanel/lib/permissions/index.ts` — module singletons (`permissionStore`, `permissionController`).
- `src/sidepanel/lib/chat.ts` — **modify**: accept `tools` + `beforeToolCall`, track `activeTool`, skip empty assistant bubbles.
- `src/sidepanel/components/chat/useSessions.ts` — **modify**: wire tools + controller into `createSession`.
- `src/sidepanel/components/chat/usePermissions.ts` — hook exposing mode + pending approval.
- `src/sidepanel/components/chat/ToolApprovalCard.tsx` — presentational approval card.
- `src/sidepanel/components/chat/PermissionModeToggle.tsx` — ask/yolo switch.
- `src/sidepanel/App.tsx` — **modify**: render the card + toggle + running indicator.

**Manifest:** add `"debugger"` permission.

---

## Task 1: In-extension control protocol + `debugger` permission

**Files:**
- Create: `src/control/protocol.ts`
- Modify: `manifest.json`
- Test: `test/controlProtocol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/controlProtocol.test.ts
import { describe, expect, test } from "bun:test";
import { isToolExecRequest, TOOL_NAMES } from "../src/control/protocol.ts";

describe("control protocol", () => {
  test("isToolExecRequest accepts a well-formed request", () => {
    expect(isToolExecRequest({ type: "OBC_TOOL_EXEC", requestId: "r1", tool: "navigate", args: {} })).toBe(true);
  });
  test("isToolExecRequest rejects foreign messages", () => {
    expect(isToolExecRequest({ type: "SOMETHING_ELSE" })).toBe(false);
    expect(isToolExecRequest(null)).toBe(false);
    expect(isToolExecRequest({ type: "OBC_TOOL_EXEC", tool: "navigate" })).toBe(false);
  });
  test("TOOL_NAMES lists the v1 tool set", () => {
    expect(TOOL_NAMES).toEqual([
      "navigate", "read_page", "get_page_text", "click", "type", "scroll", "screenshot", "wait_for",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/controlProtocol.test.ts`
Expected: FAIL — cannot find module `../src/control/protocol.ts`.

- [ ] **Step 3: Create `src/control/protocol.ts`**

```ts
/**
 * In-extension control protocol: messages exchanged between the sidepanel (where
 * the pi Agent + its tools run) and the service worker (which holds the browser
 * executors). This is DISTINCT from `@obc/shared` — that is the native-messaging
 * wire contract for the future MCP path; this is internal chrome.runtime messaging.
 */
export const TOOL_NAMES = [
  "navigate",
  "read_page",
  "get_page_text",
  "click",
  "type",
  "scroll",
  "screenshot",
  "wait_for",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolExecRequest {
  type: "OBC_TOOL_EXEC";
  requestId: string;
  tool: ToolName;
  args: Record<string, unknown>;
}

/** Text or image content handed back to the model (mirrors pi's content union). */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolExecOk {
  ok: true;
  content: ToolContent[];
}
export interface ToolExecErr {
  ok: false;
  error: string;
}
export type ToolExecResult = ToolExecOk | ToolExecErr;

const NAME_SET = new Set<string>(TOOL_NAMES);

/** Runtime guard so the SW ignores unrelated chrome.runtime messages. */
export function isToolExecRequest(msg: unknown): msg is ToolExecRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === "OBC_TOOL_EXEC" &&
    typeof m.requestId === "string" &&
    typeof m.tool === "string" &&
    NAME_SET.has(m.tool) &&
    typeof m.args === "object" &&
    m.args !== null
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/controlProtocol.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `debugger` permission to `manifest.json`**

Change the `permissions` array (currently `["nativeMessaging", "tabs", "scripting", "activeTab", "sidePanel", "tabGroups", "storage", "unlimitedStorage"]`) to include `"debugger"`:

```json
  "permissions": ["nativeMessaging", "tabs", "scripting", "activeTab", "sidePanel", "tabGroups", "storage", "unlimitedStorage", "debugger"],
```

- [ ] **Step 6: Typecheck + commit**

Run: `bun run typecheck` → Expected: clean.
```bash
git add src/control/protocol.ts manifest.json test/controlProtocol.test.ts
git commit -m "feat(control): in-extension tool protocol + debugger permission"
```

---

## Task 2: Injected page functions (perception primitives)

These run **inside the page**. They must be self-contained. We test them with `happy-dom` by installing a global `document`/`window`/`getComputedStyle`.

**Files:**
- Create: `src/control/inject/page-fns.ts`
- Test: `test/pageFns.test.ts`
- Modify: `package.json` (add `happy-dom` devDep)

- [ ] **Step 1: Add happy-dom**

Run: `bun add -d happy-dom`
Expected: `happy-dom` appears under `devDependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// test/pageFns.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  buildAccessibilityTree,
  extractPageText,
  focusRef,
  getRefRect,
  waitForInPage,
} from "../src/control/inject/page-fns.ts";

let win: Window;
function setBody(html: string) {
  (globalThis as any).document.body.innerHTML = html;
}
beforeEach(() => {
  win = new Window({ url: "https://example.com" });
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).getComputedStyle = win.getComputedStyle.bind(win);
});
afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).getComputedStyle;
});

describe("buildAccessibilityTree", () => {
  test("stamps refs on interactive elements and emits role + name", () => {
    setBody(`<button>Sign in</button><a href="/x">Docs</a><p>ignored</p>`);
    const tree = buildAccessibilityTree(true);
    expect(tree).toContain('[e1] button "Sign in"');
    expect(tree).toContain('[e2] a "Docs"');
    expect(tree).not.toContain("ignored");
    expect((globalThis as any).document.querySelector("button")!.getAttribute("data-obc-ref")).toBe("e1");
  });

  test("re-running clears stale refs", () => {
    setBody(`<button>One</button>`);
    buildAccessibilityTree(true);
    setBody(`<button>Two</button>`);
    buildAccessibilityTree(true);
    const refs = [...(globalThis as any).document.querySelectorAll("[data-obc-ref]")];
    expect(refs).toHaveLength(1);
    expect(refs[0]!.getAttribute("data-obc-ref")).toBe("e1");
  });

  test("non-interactive mode also includes headings", () => {
    setBody(`<h1>Title</h1><button>Go</button>`);
    const tree = buildAccessibilityTree(false);
    expect(tree).toContain("Title");
    expect(tree).toContain("Go");
  });

  test("returns a sentinel when nothing matches", () => {
    setBody(`<p>just text</p>`);
    expect(buildAccessibilityTree(true)).toBe("(no interactive elements found)");
  });
});

describe("getRefRect / focusRef", () => {
  test("getRefRect reports found=false for an unknown ref", () => {
    setBody(`<button>Hi</button>`);
    expect(getRefRect("e99").found).toBe(false);
  });
  test("focusRef focuses a known ref", () => {
    setBody(`<input />`);
    buildAccessibilityTree(true);
    expect(focusRef("e1").found).toBe(true);
  });
});

describe("extractPageText", () => {
  test("strips scripts/styles and collapses whitespace", () => {
    setBody(`<script>var x=1</script><style>.a{}</style><article>Hello   world</article>`);
    const text = extractPageText();
    expect(text).toContain("Hello world");
    expect(text).not.toContain("var x");
  });
});

describe("waitForInPage", () => {
  test("resolves found=true immediately when the selector is present", async () => {
    setBody(`<div id="ready">ok</div>`);
    expect(await waitForInPage({ selector: "#ready", timeoutMs: 500 })).toEqual({ found: true });
  });
  test("resolves found=false after timeout when absent", async () => {
    setBody(`<div></div>`);
    expect(await waitForInPage({ selector: "#nope", timeoutMs: 120 })).toEqual({ found: false });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/pageFns.test.ts`
Expected: FAIL — cannot find module `../src/control/inject/page-fns.ts`.

- [ ] **Step 4: Create `src/control/inject/page-fns.ts`**

```ts
/**
 * Functions injected into the page via chrome.scripting.executeScript({ func }).
 * CRITICAL: each function must be fully self-contained — no imports, no
 * module-scope references — because Chrome serializes them with `.toString()`.
 * They use the page globals `document`, `getComputedStyle`, `Date`, `setTimeout`.
 */

/**
 * Walk the DOM, stamp `data-obc-ref` on interactive (and, unless interactiveOnly,
 * heading) elements, and return a compact one-line-per-element listing the model
 * can act on. Clears refs from a previous run so refs always reflect this read.
 */
export function buildAccessibilityTree(interactiveOnly: boolean): string {
  const INTERACTIVE =
    'a[href],button,input,select,textarea,[role],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]';

  const doc = document;
  doc.querySelectorAll("[data-obc-ref]").forEach((el) => el.removeAttribute("data-obc-ref"));

  const accName = (el: Element): string => {
    const input = el as HTMLInputElement;
    const raw =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("alt") ||
      (typeof input.value === "string" ? input.value : "") ||
      (el.textContent || "") ||
      el.getAttribute("title") ||
      "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 80);
  };
  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el as HTMLElement);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const roleOf = (el: Element): string => el.getAttribute("role") || el.tagName.toLowerCase();

  const selector = interactiveOnly ? INTERACTIVE : INTERACTIVE + ",h1,h2,h3,h4,h5,h6";
  const lines: string[] = [];
  let counter = 0;
  for (const el of Array.from(doc.querySelectorAll(selector))) {
    if (!isVisible(el)) continue;
    const ref = "e" + ++counter;
    el.setAttribute("data-obc-ref", ref);
    const label = accName(el);
    lines.push(`[${ref}] ${roleOf(el)}${label ? ` "${label}"` : ""}`);
  }
  return lines.length ? lines.join("\n") : "(no interactive elements found)";
}

/** Resolve a ref to its viewport-center coordinates (CSS px), scrolling into view. */
export function getRefRect(ref: string): { found: boolean; x: number; y: number } {
  const el = document.querySelector(`[data-obc-ref="${ref}"]`) as HTMLElement | null;
  if (!el) return { found: false, x: 0, y: 0 };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Focus a ref so a subsequent CDP Input.insertText lands in it. */
export function focusRef(ref: string): { found: boolean } {
  const el = document.querySelector(`[data-obc-ref="${ref}"]`) as HTMLElement | null;
  if (!el) return { found: false };
  el.focus();
  return { found: true };
}

/** Best-effort readable text extraction. */
export function extractPageText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,style,noscript,svg").forEach((el) => el.remove());
  return (clone.textContent || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20000);
}

/** Poll until a selector matches or text appears, or the timeout elapses. */
export async function waitForInPage(opts: {
  selector?: string;
  text?: string;
  timeoutMs: number;
}): Promise<{ found: boolean }> {
  const deadline = Date.now() + opts.timeoutMs;
  const check = (): boolean => {
    if (opts.selector && document.querySelector(opts.selector)) return true;
    if (opts.text && (document.body.textContent || "").includes(opts.text)) return true;
    return false;
  };
  while (Date.now() < deadline) {
    if (check()) return { found: true };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { found: check() };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/pageFns.test.ts`
Expected: PASS (all). If happy-dom lacks `scrollIntoView`, it is a no-op there — the test does not assert on it.

- [ ] **Step 6: Typecheck + commit**

Run: `bun run typecheck` → clean.
```bash
git add src/control/inject/page-fns.ts test/pageFns.test.ts package.json
git commit -m "feat(control): injected page perception functions"
```

---

## Task 3: CDP manager + active-tab resolver

Thin Chrome-API glue; verified by extension load, not unit tests. Keep them tiny.

**Files:**
- Create: `src/control/cdp.ts`
- Create: `src/control/tabs.ts`

- [ ] **Step 1: Create `src/control/tabs.ts`**

```ts
/** The tab the agent should act on: active tab of the last focused normal window. */
export async function resolveActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback?.id != null ? fallback : undefined;
}
```

- [ ] **Step 2: Create `src/control/cdp.ts`**

```ts
/**
 * chrome.debugger (CDP) wrapper. Attaches lazily per tab and auto-detaches after
 * an idle window so the "is being debugged" banner does not linger. Mirrors the
 * reference extension's ~20s idle detach.
 */
const PROTOCOL_VERSION = "1.3";
const IDLE_DETACH_MS = 20_000;

const attached = new Set<number>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  attached.add(tabId);
}

function scheduleDetach(tabId: number): void {
  const existing = idleTimers.get(tabId);
  if (existing) clearTimeout(existing);
  idleTimers.set(
    tabId,
    setTimeout(() => void detach(tabId), IDLE_DETACH_MS),
  );
}

export async function detach(tabId: number): Promise<void> {
  const timer = idleTimers.get(tabId);
  if (timer) clearTimeout(timer);
  idleTimers.delete(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // tab may have closed; ignore.
  }
}

/** Send a CDP command, attaching first and resetting the idle-detach timer. */
export async function cdpSend<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  await ensureAttached(tabId);
  try {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  } finally {
    scheduleDetach(tabId);
  }
}

// Clean up if the user (or DevTools) detaches out from under us.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attached.delete(source.tabId);
    const timer = idleTimers.get(source.tabId);
    if (timer) clearTimeout(timer);
    idleTimers.delete(source.tabId);
  }
});
```

- [ ] **Step 3: Typecheck + commit**

Run: `bun run typecheck` → clean.
```bash
git add src/control/cdp.ts src/control/tabs.ts
git commit -m "feat(control): CDP manager + active-tab resolver"
```

---

## Task 4: Executors + dispatch map

**Files:**
- Create: `src/control/executors.ts`

- [ ] **Step 1: Create `src/control/executors.ts`**

```ts
import { cdpSend } from "./cdp.ts";
import {
  buildAccessibilityTree,
  extractPageText,
  focusRef,
  getRefRect,
  waitForInPage,
} from "./inject/page-fns.ts";
import type { ToolContent, ToolExecResult, ToolName } from "./protocol.ts";

type Args = Record<string, unknown>;
type Executor = (args: Args, tabId: number) => Promise<ToolExecResult>;

const ok = (text: string): ToolExecResult => ({ ok: true, content: [{ type: "text", text }] });
const okContent = (content: ToolContent[]): ToolExecResult => ({ ok: true, content });
const err = (error: string): ToolExecResult => ({ ok: false, error });

/** Run one self-contained function in the page and return its value. */
async function inPage<R, A extends unknown[]>(
  tabId: number,
  func: (...a: A) => R,
  args: A,
): Promise<R> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result as R;
}

const navigate: Executor = async (args, tabId) => {
  const direction = args.direction;
  if (direction === "back") {
    await chrome.tabs.goBack(tabId);
    return ok("Navigated back.");
  }
  if (direction === "forward") {
    await chrome.tabs.goForward(tabId);
    return ok("Navigated forward.");
  }
  const url = args.url;
  if (typeof url !== "string" || !url) return err("navigate requires a `url` or `direction`.");
  await chrome.tabs.update(tabId, { url });
  return ok(`Navigated to ${url}.`);
};

const readPage: Executor = async (args, tabId) => {
  const interactiveOnly = args.interactiveOnly !== false; // default true
  const tree = await inPage(tabId, buildAccessibilityTree, [interactiveOnly]);
  return ok(tree);
};

const getPageText: Executor = async (_args, tabId) => {
  const text = await inPage(tabId, extractPageText, []);
  return ok(text || "(empty page)");
};

const click: Executor = async (args, tabId) => {
  const ref = args.ref;
  if (typeof ref !== "string") return err("click requires a `ref` from read_page.");
  const rect = await inPage(tabId, getRefRect, [ref]);
  if (!rect?.found) return err(`No element for ref "${ref}". Call read_page again.`);
  const base = { x: rect.x, y: rect.y, button: "left" as const, clickCount: 1 };
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  return ok(`Clicked ${ref}.`);
};

const type: Executor = async (args, tabId) => {
  const ref = args.ref;
  const text = args.text;
  if (typeof ref !== "string") return err("type requires a `ref`.");
  if (typeof text !== "string") return err("type requires `text`.");
  const focused = await inPage(tabId, focusRef, [ref]);
  if (!focused?.found) return err(`No element for ref "${ref}". Call read_page again.`);
  await cdpSend(tabId, "Input.insertText", { text });
  return ok(`Typed into ${ref}.`);
};

const scroll: Executor = async (args, tabId) => {
  const direction = args.direction === "up" ? "up" : "down";
  const amount = typeof args.amount === "number" ? args.amount : 600;
  const size = await inPage(tabId, () => ({ w: window.innerWidth, h: window.innerHeight }), []);
  const x = Math.floor((size?.w ?? 800) / 2);
  const y = Math.floor((size?.h ?? 600) / 2);
  await cdpSend(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY: direction === "up" ? -amount : amount,
  });
  return ok(`Scrolled ${direction}.`);
};

const screenshot: Executor = async (_args, tabId) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId == null) return err("Cannot screenshot: no window for tab.");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const data = dataUrl.replace(/^data:image\/png;base64,/, "");
  return okContent([{ type: "image", data, mimeType: "image/png" }]);
};

const waitFor: Executor = async (args, tabId) => {
  const selector = typeof args.selector === "string" ? args.selector : undefined;
  const text = typeof args.text === "string" ? args.text : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 5000;
  if (!selector && !text) return err("wait_for requires `selector` or `text`.");
  const result = await inPage(tabId, waitForInPage, [{ selector, text, timeoutMs }]);
  return result?.found
    ? ok("Condition met.")
    : err(`Timed out after ${timeoutMs}ms waiting for ${selector ?? text}.`);
};

const EXECUTORS: Record<ToolName, Executor> = {
  navigate,
  read_page: readPage,
  get_page_text: getPageText,
  click,
  type,
  scroll,
  screenshot,
  wait_for: waitFor,
};

/** Route a tool call to its executor, normalizing thrown errors into ToolExecErr. */
export async function dispatch(tool: ToolName, args: Args, tabId: number): Promise<ToolExecResult> {
  const executor = EXECUTORS[tool];
  if (!executor) return { ok: false, error: `Unknown tool "${tool}".` };
  try {
    return await executor(args, tabId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `bun run typecheck` → clean.
```bash
git add src/control/executors.ts
git commit -m "feat(control): browser executors + dispatch map"
```

---

## Task 5: Service-worker message dispatcher

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Add the dispatcher to `src/background.ts`**

Add these imports at the top of the file:

```ts
import { isToolExecRequest, type ToolExecResult } from "./control/protocol.ts";
import { dispatch } from "./control/executors.ts";
import { resolveActiveTab } from "./control/tabs.ts";
```

Append this listener at the end of the file:

```ts
// Tool execution requests from the sidepanel agent. Resolve the active tab,
// dispatch to the executor, and reply with a ToolExecResult.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isToolExecRequest(message)) return false;
  void (async () => {
    const reply = (result: ToolExecResult) => sendResponse(result);
    try {
      const tab = await resolveActiveTab();
      if (!tab?.id) {
        reply({ ok: false, error: "No active tab to act on." });
        return;
      }
      if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
        reply({ ok: false, error: "Cannot control browser-internal pages." });
        return;
      }
      reply(await dispatch(message.tool, message.args, tab.id));
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
```

- [ ] **Step 2: Typecheck + build**

Run: `bun run typecheck` → clean.
Run: `bun run build` → Expected: builds; `dist/src/background.js` includes the control modules.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "feat(control): service-worker tool dispatcher"
```

---

## Task 6: Sidepanel tool client + AgentTool definitions

**Files:**
- Create: `src/sidepanel/lib/tools/client.ts`
- Create: `src/sidepanel/lib/tools/browserTools.ts`
- Test: `test/browserTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/browserTools.test.ts
import { describe, expect, test } from "bun:test";
import { createBrowserTools, MUTATING_TOOLS } from "../src/sidepanel/lib/tools/browserTools.ts";
import type { ToolExecResult } from "../src/control/protocol.ts";

function toolsWith(exec: (tool: string, args: Record<string, unknown>) => Promise<ToolExecResult>) {
  return createBrowserTools(exec);
}

describe("createBrowserTools", () => {
  test("exposes the v1 tool set with names + schemas", () => {
    const names = toolsWith(async () => ({ ok: true, content: [] })).map((t) => t.name).sort();
    expect(names).toEqual(
      ["click", "get_page_text", "navigate", "read_page", "screenshot", "scroll", "type", "wait_for"].sort(),
    );
    for (const t of toolsWith(async () => ({ ok: true, content: [] }))) {
      expect(typeof t.description).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.parameters).toBeDefined();
    }
  });

  test("execute maps an ok result to AgentToolResult content", async () => {
    const tools = toolsWith(async (tool) => {
      expect(tool).toBe("read_page");
      return { ok: true, content: [{ type: "text", text: "tree" }] };
    });
    const readPage = tools.find((t) => t.name === "read_page")!;
    const result = await readPage.execute("id1", { interactiveOnly: true });
    expect(result.content).toEqual([{ type: "text", text: "tree" }]);
  });

  test("execute throws on an error result (pi turns it into an error tool result)", async () => {
    const tools = toolsWith(async () => ({ ok: false, error: "boom" }));
    const navigate = tools.find((t) => t.name === "navigate")!;
    await expect(navigate.execute("id2", { url: "https://x" })).rejects.toThrow("boom");
  });

  test("MUTATING_TOOLS contains exactly navigate, click, type", () => {
    expect([...MUTATING_TOOLS].sort()).toEqual(["click", "navigate", "type"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/browserTools.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/sidepanel/lib/tools/client.ts`**

```ts
import type { ToolExecResult, ToolName } from "@/../control/protocol";

/**
 * Send a tool call to the service worker and await its ToolExecResult.
 * Note path alias: `@` → src/sidepanel, so we reach src/control via `@/../control`.
 */
export async function execTool(
  tool: ToolName,
  args: Record<string, unknown>,
): Promise<ToolExecResult> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "OBC_TOOL_EXEC",
      requestId: crypto.randomUUID(),
      tool,
      args,
    })) as ToolExecResult | undefined;
    if (!response) return { ok: false, error: "No response from service worker." };
    return response;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

> If the `@/../control/protocol` alias import does not resolve under the bundler/tsconfig, fall back to a relative import: `import type { ToolExecResult, ToolName } from "../../../control/protocol";`. Verify with `bun run typecheck` in Step 5 and switch if needed.

- [ ] **Step 4: Create `src/sidepanel/lib/tools/browserTools.ts`**

```ts
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolExecResult, ToolName } from "@/../control/protocol";
import { execTool as defaultExec } from "./client";

/** Tools that change page/world state and are gated in `ask` mode. */
export const MUTATING_TOOLS = new Set<ToolName>(["navigate", "click", "type"]);

type Exec = (tool: ToolName, args: Record<string, unknown>) => Promise<ToolExecResult>;

interface Spec {
  name: ToolName;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
}

const SPECS: Spec[] = [
  {
    name: "navigate",
    label: "Navigate",
    description: "Navigate the active tab to a URL, or go back/forward in history.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Absolute URL to open." })),
      direction: Type.Optional(
        Type.Union([Type.Literal("back"), Type.Literal("forward")], {
          description: "Go back or forward instead of opening a URL.",
        }),
      ),
    }),
  },
  {
    name: "read_page",
    label: "Read page",
    description:
      "Return a compact accessibility tree of the active page. Each line is `[ref] role \"name\"`; use a ref with click/type.",
    parameters: Type.Object({
      interactiveOnly: Type.Optional(
        Type.Boolean({ description: "Only interactive elements (default true)." }),
      ),
    }),
  },
  {
    name: "get_page_text",
    label: "Read text",
    description: "Return the readable text content of the active page.",
    parameters: Type.Object({}),
  },
  {
    name: "click",
    label: "Click",
    description: "Click an element by its ref from read_page.",
    parameters: Type.Object({ ref: Type.String({ description: "Element ref, e.g. e3." }) }),
  },
  {
    name: "type",
    label: "Type",
    description: "Focus an element by ref and type text into it.",
    parameters: Type.Object({
      ref: Type.String({ description: "Element ref to type into." }),
      text: Type.String({ description: "Text to insert." }),
    }),
  },
  {
    name: "scroll",
    label: "Scroll",
    description: "Scroll the page up or down.",
    parameters: Type.Object({
      direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
      amount: Type.Optional(Type.Number({ description: "Pixels (default 600)." })),
    }),
  },
  {
    name: "screenshot",
    label: "Screenshot",
    description: "Capture a PNG screenshot of the visible viewport.",
    parameters: Type.Object({}),
  },
  {
    name: "wait_for",
    label: "Wait for",
    description: "Wait until a CSS selector matches or text appears (or timeout).",
    parameters: Type.Object({
      selector: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number({ description: "Default 5000." })),
    }),
  },
];

/** Build the pi AgentTools. `exec` is injected for tests; defaults to the SW client. */
export function createBrowserTools(exec: Exec = defaultExec): AgentTool<any>[] {
  return SPECS.map((spec) => ({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      const result = await exec(spec.name, args ?? {});
      if (!result.ok) throw new Error(result.error); // pi → error tool result
      return { content: result.content, details: null };
    },
  }));
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test test/browserTools.test.ts` → Expected: PASS.
Run: `bun run typecheck` → clean. If the `@/../control/protocol` alias fails, switch both files to the relative path noted in Step 3 and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/lib/tools/ test/browserTools.test.ts
git commit -m "feat(tools): sidepanel tool client + AgentTool definitions"
```

---

## Task 7: Permission store + controller

**Files:**
- Create: `src/sidepanel/lib/permissions/store.ts`
- Create: `src/sidepanel/lib/permissions/PermissionController.ts`
- Create: `src/sidepanel/lib/permissions/index.ts`
- Test: `test/permissionController.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/permissionController.test.ts
import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/storage/kv.ts";
import { PermissionStore } from "../src/sidepanel/lib/permissions/store.ts";
import { PermissionController } from "../src/sidepanel/lib/permissions/PermissionController.ts";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";

function ctx(toolName: string): BeforeToolCallContext {
  return { toolCall: { name: toolName } } as unknown as BeforeToolCallContext;
}

function build(opts: { origin?: string } = {}) {
  let n = 0;
  const store = new PermissionStore(new MemoryKv());
  const controller = new PermissionController({
    store,
    mutatingTools: new Set(["navigate", "click", "type"]),
    getActiveOrigin: async () => opts.origin ?? "example.com",
    newId: () => `p${n++}`,
  });
  return { store, controller };
}

describe("PermissionController", () => {
  test("non-mutating tools are always allowed (no prompt)", async () => {
    const { controller } = build();
    expect(await controller.beforeToolCall(ctx("read_page"))).toBeUndefined();
    expect(controller.pending()).toBeUndefined();
  });

  test("yolo mode allows mutating tools without prompting", async () => {
    const { store, controller } = build();
    await store.setMode("yolo");
    expect(await controller.beforeToolCall(ctx("click"))).toBeUndefined();
    expect(controller.pending()).toBeUndefined();
  });

  test("ask mode: deny blocks the call", async () => {
    const { controller } = build();
    const p = controller.beforeToolCall(ctx("click"));
    const pending = controller.pending()!;
    expect(pending.tool).toBe("click");
    controller.resolve(pending.id, "deny");
    expect(await p).toEqual({ block: true, reason: "Denied by user" });
  });

  test("ask mode: allow once permits but does not persist", async () => {
    const { store, controller } = build();
    const p = controller.beforeToolCall(ctx("click"));
    controller.resolve(controller.pending()!.id, "once");
    expect(await p).toBeUndefined();
    expect(await store.isAllowed("example.com")).toBe(false);
  });

  test("ask mode: allow always persists the origin and skips later prompts", async () => {
    const { store, controller } = build();
    const p = controller.beforeToolCall(ctx("navigate"));
    controller.resolve(controller.pending()!.id, "always");
    expect(await p).toBeUndefined();
    expect(await store.isAllowed("example.com")).toBe(true);
    // Second mutating call: no prompt.
    expect(await controller.beforeToolCall(ctx("click"))).toBeUndefined();
    expect(controller.pending()).toBeUndefined();
  });

  test("concurrent prompts queue; resolving the head advances", async () => {
    const { controller } = build();
    const p1 = controller.beforeToolCall(ctx("click"));
    const p2 = controller.beforeToolCall(ctx("type"));
    const first = controller.pending()!;
    expect(first.tool).toBe("click");
    controller.resolve(first.id, "deny");
    expect(await p1).toEqual({ block: true, reason: "Denied by user" });
    const second = controller.pending()!;
    expect(second.tool).toBe("type");
    controller.resolve(second.id, "once");
    expect(await p2).toBeUndefined();
  });

  test("mode round-trips through the store and notifies subscribers", async () => {
    const { controller } = build();
    let calls = 0;
    controller.subscribe(() => calls++);
    await controller.setMode("yolo");
    expect(await controller.getMode()).toBe("yolo");
    expect(calls).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/permissionController.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/sidepanel/lib/permissions/store.ts`**

```ts
import { defaultKv, type Kv } from "@/lib/storage/kv";

export type PermissionMode = "ask" | "yolo";

const MODE_KEY = "obc.perm.mode";
const ALLOW_KEY = "obc.perm.allowed";

/** Persists the permission mode and the per-origin "always allow" list. */
export class PermissionStore {
  constructor(private readonly kv: Kv = defaultKv) {}

  async getMode(): Promise<PermissionMode> {
    return (await this.kv.get(MODE_KEY)) === "yolo" ? "yolo" : "ask";
  }
  async setMode(mode: PermissionMode): Promise<void> {
    await this.kv.set(MODE_KEY, mode);
  }
  async isAllowed(origin: string): Promise<boolean> {
    return (await this.list()).includes(origin);
  }
  async allowOrigin(origin: string): Promise<void> {
    const list = await this.list();
    if (!list.includes(origin)) await this.kv.set(ALLOW_KEY, [...list, origin]);
  }
  private async list(): Promise<string[]> {
    const value = await this.kv.get(ALLOW_KEY);
    return Array.isArray(value) ? (value as string[]) : [];
  }
}
```

- [ ] **Step 4: Create `src/sidepanel/lib/permissions/PermissionController.ts`**

```ts
import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { PermissionMode, PermissionStore } from "./store";

export type ApprovalDecision = "once" | "always" | "deny";

export interface PendingApproval {
  id: string;
  tool: string;
  origin?: string;
}

export interface PermissionControllerDeps {
  store: PermissionStore;
  mutatingTools: Set<string>;
  getActiveOrigin: () => Promise<string | undefined>;
  newId?: () => string;
}

/**
 * pi `beforeToolCall` guard. Reads are always allowed; in `yolo` everything is
 * allowed; in `ask`, mutating tools need the active origin to be remembered or a
 * fresh user decision. Surfaces approvals via a queue the UI renders + resolves.
 */
export class PermissionController {
  private readonly store: PermissionStore;
  private readonly mutating: Set<string>;
  private readonly getActiveOrigin: () => Promise<string | undefined>;
  private readonly newId: () => string;
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Map<string, (d: ApprovalDecision) => void>();
  private queue: PendingApproval[] = [];

  constructor(deps: PermissionControllerDeps) {
    this.store = deps.store;
    this.mutating = deps.mutatingTools;
    this.getActiveOrigin = deps.getActiveOrigin;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** The approval currently shown to the user (head of the queue). */
  pending(): PendingApproval | undefined {
    return this.queue[0];
  }

  getMode(): Promise<PermissionMode> {
    return this.store.getMode();
  }
  async setMode(mode: PermissionMode): Promise<void> {
    await this.store.setMode(mode);
    this.notify();
  }

  /** Bound so it can be passed directly as the Agent's beforeToolCall. */
  beforeToolCall = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const tool = ctx.toolCall.name;
    if (!this.mutating.has(tool)) return undefined;
    if ((await this.store.getMode()) === "yolo") return undefined;
    const origin = await this.getActiveOrigin();
    if (origin && (await this.store.isAllowed(origin))) return undefined;

    const decision = await this.request(tool, origin);
    if (decision === "deny") return { block: true, reason: "Denied by user" };
    if (decision === "always" && origin) await this.store.allowOrigin(origin);
    return undefined;
  };

  private request(tool: string, origin?: string): Promise<ApprovalDecision> {
    const id = this.newId();
    return new Promise<ApprovalDecision>((resolve) => {
      this.waiters.set(id, resolve);
      this.queue.push({ id, tool, origin });
      this.notify();
    });
  }

  /** Called by the UI with the user's choice for a queued approval. */
  resolve(id: string, decision: ApprovalDecision): void {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    this.waiters.delete(id);
    this.queue = this.queue.filter((p) => p.id !== id);
    waiter(decision);
    this.notify();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/permissionController.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Create the singletons `src/sidepanel/lib/permissions/index.ts`**

```ts
import { MUTATING_TOOLS } from "@/lib/tools/browserTools";
import { PermissionController } from "./PermissionController";
import { PermissionStore } from "./store";

export { PermissionController } from "./PermissionController";
export { PermissionStore } from "./store";
export type { ApprovalDecision, PendingApproval } from "./PermissionController";
export type { PermissionMode } from "./store";

/** Active tab hostname, used to scope "always allow on this site". */
async function activeOrigin(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return undefined;
    return new URL(tab.url).hostname;
  } catch {
    return undefined;
  }
}

export const permissionStore = new PermissionStore();
export const permissionController = new PermissionController({
  store: permissionStore,
  mutatingTools: MUTATING_TOOLS,
  getActiveOrigin: activeOrigin,
});
```

- [ ] **Step 7: Typecheck + commit**

Run: `bun run typecheck` → clean.
```bash
git add src/sidepanel/lib/permissions/ test/permissionController.test.ts
git commit -m "feat(permissions): store + beforeToolCall guard controller"
```

---

## Task 8: Wire tools + guard + activeTool into `chat.ts`

**Files:**
- Modify: `src/sidepanel/lib/chat.ts`
- Test: `test/chat.test.ts` (extend)

- [ ] **Step 1: Write the failing tests (append to `test/chat.test.ts`)**

```ts
// Append inside test/chat.test.ts (it already imports ChatSession + a fake streamFn).
import type { AgentTool } from "@earendil-works/pi-agent-core";
// (Reuse the existing test's model + streamFn helpers.)

describe("ChatSession tool wiring", () => {
  test("getMessages skips assistant messages that have no text (pure tool calls)", () => {
    // Build a session seeded with an assistant message whose text is empty.
    const session = new ChatSession({
      model: TEST_MODEL, // from existing test scope
      getToken: () => "key",
      initialMessages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "" },
        { role: "assistant", text: "real answer" },
      ],
    });
    const texts = session.getMessages().map((m) => m.text);
    expect(texts).toEqual(["hi", "real answer"]);
  });

  test("activeTool() is undefined before any tool runs", () => {
    const session = new ChatSession({ model: TEST_MODEL, getToken: () => "key" });
    expect(session.activeTool()).toBeUndefined();
  });

  test("accepts tools and a beforeToolCall option without throwing", () => {
    const noopTool: AgentTool<any> = {
      name: "noop",
      label: "Noop",
      description: "noop",
      parameters: { type: "object", properties: {} } as any,
      execute: async () => ({ content: [], details: null }),
    };
    const session = new ChatSession({
      model: TEST_MODEL,
      getToken: () => "key",
      tools: [noopTool],
      beforeToolCall: async () => undefined,
    });
    expect(session).toBeDefined();
  });
});
```

> Use the existing test file's `TEST_MODEL` constant. If it is named differently (e.g. `model`), match the existing name. Check the top of `test/chat.test.ts` first.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/chat.test.ts`
Expected: FAIL — `tools`/`beforeToolCall` not in options; `activeTool` not a method; empty-assistant filtering absent.

- [ ] **Step 3: Edit `src/sidepanel/lib/chat.ts`**

3a. Update imports (add `AgentTool` and `AgentOptions`):

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn, AgentMessage, AgentTool, AgentOptions } from "@earendil-works/pi-agent-core";
```

3b. Extend `ChatSessionOptions` (add two fields after `streamFn`):

```ts
  /** Browser-control (or other) tools to register with the agent. */
  tools?: AgentTool<any>[];
  /** Permission gate fired before each tool runs. */
  beforeToolCall?: AgentOptions["beforeToolCall"];
```

3c. Extend `ChatSessionLike` with `activeTool`:

```ts
export interface ChatSessionLike {
  send(text: string): Promise<void>;
  abort(): void;
  getMessages(): ChatMessageView[];
  isStreaming(): boolean;
  error(): string | undefined;
  activeTool(): string | undefined;
  subscribe(listener: () => void): () => void;
}
```

3d. Add a private field and track tool events. Replace the constructor body's `new Agent(...)` + subscribe block with:

```ts
  private readonly agent: Agent;
  private readonly listeners = new Set<() => void>();
  private activeToolName: string | undefined;

  constructor(options: ChatSessionOptions) {
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

    this.agent.subscribe((event) => {
      if (event.type === "tool_execution_start") this.activeToolName = event.toolName;
      else if (event.type === "tool_execution_end") this.activeToolName = undefined;
      for (const listener of this.listeners) listener();
    });
  }
```

3e. Add the `activeTool` accessor (next to `error()`):

```ts
  activeTool(): string | undefined {
    return this.activeToolName;
  }
```

3f. Filter empty assistant bubbles in `getMessages()`. Change the assistant branch:

```ts
  getMessages(): ChatMessageView[] {
    const views: ChatMessageView[] = [];
    for (const msg of this.agent.state.messages) {
      if (msg.role === "user") {
        views.push({ role: "user", text: messageText(msg.content) });
      } else if (msg.role === "assistant") {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/chat.test.ts`
Expected: PASS (existing + 3 new). The existing "seeds initial messages" test must still pass — empty-text assistant seeds are now filtered from the *view* only, not from what's sent to the model.

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck` → clean.
```bash
git add src/sidepanel/lib/chat.ts test/chat.test.ts
git commit -m "feat(chat): register tools + permission hook, track active tool"
```

---

## Task 9: Wire tools + controller through `useSessions`

**Files:**
- Modify: `src/sidepanel/components/chat/useSessions.ts`

- [ ] **Step 1: Edit `createManager()` in `useSessions.ts`**

Add imports near the top:

```ts
import { createBrowserTools } from "@/lib/tools/browserTools";
import { permissionController } from "@/lib/permissions";
```

Change the `createSession` factory to pass tools + the guard:

```ts
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
```

- [ ] **Step 2: Surface `activeTool` from the hook**

In the `useSessions()` return, add `activeTool` (and to the `UseSessions` interface):

```ts
  const session = mgr.activeSession();
  const streaming = session?.isStreaming() ?? false;
  const messages = session ? toUiMessages(session.getMessages(), streaming) : [];
  // ...
  return {
    // ...existing fields...
    activeTool: session?.activeTool(),
  };
```

Add `activeTool?: string;` to the `UseSessions` interface.

- [ ] **Step 3: Typecheck + run full suite**

Run: `bun run typecheck` → clean.
Run: `bun test` → Expected: all prior + new tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/chat/useSessions.ts
git commit -m "feat(sessions): wire browser tools + permission guard into sessions"
```

---

## Task 10: Approval UI — card, mode toggle, running indicator

**Files:**
- Create: `src/sidepanel/components/chat/usePermissions.ts`
- Create: `src/sidepanel/components/chat/ToolApprovalCard.tsx`
- Create: `src/sidepanel/components/chat/PermissionModeToggle.tsx`
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: Create `usePermissions.ts`**

```ts
import { useEffect, useState } from "react";
import { permissionController } from "@/lib/permissions";
import type { ApprovalDecision, PendingApproval, PermissionMode } from "@/lib/permissions";

export interface UsePermissions {
  mode: PermissionMode;
  pending?: PendingApproval;
  setMode: (mode: PermissionMode) => void;
  resolve: (id: string, decision: ApprovalDecision) => void;
}

export function usePermissions(): UsePermissions {
  const [, force] = useState(0);
  const [mode, setModeState] = useState<PermissionMode>("ask");

  useEffect(() => {
    const unsub = permissionController.subscribe(() => force((n) => n + 1));
    void permissionController.getMode().then(setModeState);
    return unsub;
  }, []);

  return {
    mode,
    pending: permissionController.pending(),
    setMode: (m) => {
      setModeState(m);
      void permissionController.setMode(m);
    },
    resolve: (id, decision) => permissionController.resolve(id, decision),
  };
}
```

- [ ] **Step 2: Create `ToolApprovalCard.tsx` (presentational)**

```tsx
import type { PendingApproval, ApprovalDecision } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface ToolApprovalCardProps {
  pending: PendingApproval;
  onDecide: (id: string, decision: ApprovalDecision) => void;
  className?: string;
}

const VERB: Record<string, string> = {
  navigate: "navigate",
  click: "click an element",
  type: "type text",
};

export function ToolApprovalCard({ pending, onDecide, className }: ToolApprovalCardProps) {
  const action = VERB[pending.tool] ?? pending.tool;
  const where = pending.origin ? ` on ${pending.origin}` : "";
  return (
    <div className={cn("rounded-lg border border-border bg-muted/40 p-3 text-sm", className)}>
      <p className="mb-2">
        Allow Claude to <span className="font-medium">{action}</span>
        {where}?
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-md bg-primary px-3 py-1 text-primary-foreground"
          onClick={() => onDecide(pending.id, "once")}
        >
          Allow once
        </button>
        {pending.origin && (
          <button
            className="rounded-md border border-border px-3 py-1"
            onClick={() => onDecide(pending.id, "always")}
          >
            Always allow on this site
          </button>
        )}
        <button
          className="rounded-md border border-border px-3 py-1 text-destructive"
          onClick={() => onDecide(pending.id, "deny")}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

> Match the exact Tailwind token classes to those already used in the codebase (e.g. check `ChatView`/`ConversationsDrawer` for `border-border`, `bg-muted`, `text-destructive`, `bg-primary`). Adjust class names to the existing design tokens if they differ.

- [ ] **Step 3: Create `PermissionModeToggle.tsx`**

```tsx
import type { PermissionMode } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface PermissionModeToggleProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  className?: string;
}

export function PermissionModeToggle({ mode, onChange, className }: PermissionModeToggleProps) {
  return (
    <button
      type="button"
      title={mode === "yolo" ? "Auto-approving tool actions" : "Asking before mutating actions"}
      onClick={() => onChange(mode === "ask" ? "yolo" : "ask")}
      className={cn(
        "rounded-md border border-border px-2 py-0.5 text-xs",
        mode === "yolo" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {mode === "yolo" ? "YOLO" : "Ask"}
    </button>
  );
}
```

- [ ] **Step 4: Render them in `App.tsx`**

Add imports:

```tsx
import { usePermissions } from "@/components/chat/usePermissions";
import { ToolApprovalCard } from "@/components/chat/ToolApprovalCard";
import { PermissionModeToggle } from "@/components/chat/PermissionModeToggle";
```

In the component body:

```tsx
const perms = usePermissions();
```

- Place `<PermissionModeToggle mode={perms.mode} onChange={perms.setMode} />` in the chat header row (next to the provider/model selectors).
- Render the approval card above the composer when there is a pending approval:

```tsx
{perms.pending && (
  <ToolApprovalCard pending={perms.pending} onDecide={perms.resolve} className="mx-3 mb-2" />
)}
```

- Show the running indicator when a tool is active. Where `sessions = useSessions()` is used, add near the messages list / above the composer:

```tsx
{sessions.activeTool && (
  <p className="mx-3 mb-1 text-xs text-muted-foreground">Running {sessions.activeTool}…</p>
)}
```

> Read `App.tsx` first to find the exact header element and composer location; insert these in the structurally correct spots. Keep styling consistent with the existing layout.

- [ ] **Step 5: Typecheck + build**

Run: `bun run typecheck` → clean.
Run: `bun run build` → builds.
Run: `bun run build:demo` → builds (the demo does not import these; just confirm nothing broke).

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/chat/usePermissions.ts \
        src/sidepanel/components/chat/ToolApprovalCard.tsx \
        src/sidepanel/components/chat/PermissionModeToggle.tsx \
        src/sidepanel/App.tsx
git commit -m "feat(ui): tool approval card, mode toggle, running indicator"
```

---

## Task 11: Full verification + manual load checklist

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: all pass (prior suite + controlProtocol + pageFns + browserTools + permissionController + chat additions). Note the count.

- [ ] **Step 2: Typecheck + production build**

Run: `bun run typecheck` → clean.
Run: `bun run build` → succeeds; confirm `dist/manifest.json` includes `"debugger"` and `dist/src/background.js` exists.

- [ ] **Step 3: Manual extension load (the only way to verify CDP + scripting paths)**

These cannot be unit-tested — verify by hand in Chrome:
1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select `packages/extension/dist`.
2. Open the side panel, connect a provider, start a chat.
3. With mode = **Ask**, ask: *"Read this page and tell me the main links."* → expect a `read_page` run with NO prompt (read), then a normal answer.
4. Ask: *"Click the first link."* → expect a `click` approval card (mutating). Choose **Allow once** → the click fires (the CDP "being debugged" banner appears, then auto-clears after ~20s idle).
5. Choose **Always allow on this site** on a later action → confirm subsequent mutations on that origin do NOT prompt.
6. Toggle to **YOLO** → confirm mutations run without prompts.
7. Try `navigate`, `type`, `scroll`, `screenshot`, `wait_for` via natural requests; confirm each works and errors surface as readable assistant messages (e.g., on a `chrome://` page it should report it can't control browser-internal pages).

- [ ] **Step 4: Report results**

Summarize: test count, build status, and the manual checklist outcomes (which tools verified, any issues).

---

## Self-Review Notes (already applied)

- **Type consistency:** `ToolName`/`ToolExecResult`/`ToolContent` (protocol) used identically across executors, client, and tools. `MUTATING_TOOLS` defined once (browserTools) and imported by the permissions singleton. `beforeToolCall`/`BeforeToolCallContext`/`BeforeToolCallResult` match pi's exact signatures. `AgentToolResult` always returns `{ content, details }`.
- **Coverage:** all 8 tools (Q1 = fuller set), CDP input path (Q2 = add CDP), gate-mutations-only + remember-per-site (Q3) — implemented in `PermissionController.beforeToolCall`.
- **Known v1 limitations (intentional, documented):** single active-tab targeting (no multi-tab); a tiny race where the guard's origin and the executor's active tab are resolved separately (acceptable for v1); `read_page` is a flat list (not nested tree); hidden-element detection is best-effort; `wait_for` supports selector/text/timeout but not network-idle. These are noted for a future iteration, not blockers.
- **No CDP/scripting unit tests:** these require a live browser; verified via the Task 11 manual checklist rather than faking Chrome internals.
```
