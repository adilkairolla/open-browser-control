# Chat Markdown + Message Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant chat messages as syntax-highlighted markdown (Streamdown + Shiki) and virtualize the message list (TanStack Virtual) inside the existing base-ui ScrollArea, with stick-to-bottom and a jump-to-bottom button.

**Architecture:** All changes are confined to the view layer; the message data model (`UiMessage`) and the `useSessions`/`useDemoChat` producers are unchanged. A new `Markdown` component wraps Streamdown (assistant only). A new `MessageList` component owns the TanStack virtualizer, hands base-ui's Viewport node to it as the scroll element, and keeps the list pinned to the bottom via a pure `isNearBottom` helper. `ChatView` delegates the message area to `MessageList`.

**Tech Stack:** React 19, Tailwind v4, base-ui, `@tanstack/react-virtual`, `streamdown` + `@streamdown/code` (Shiki), Bun + `bun:test` + happy-dom.

**Working directory for all commands:** `packages/extension` (the `@obc/extension` workspace). All file paths below are relative to the repo root.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/extension/package.json` | Add the three runtime deps | Modify |
| `packages/extension/src/sidepanel/index.css` | Tailwind `@source` for Streamdown + its animation styles | Modify |
| `packages/extension/src/sidepanel/lib/autoscroll.ts` | Pure stick-to-bottom logic (`isNearBottom`) | Create |
| `packages/extension/test/autoscroll.test.ts` | Unit tests for `isNearBottom` | Create |
| `packages/extension/src/sidepanel/components/ui/scroll-area.tsx` | Forward a `viewportRef` to base-ui's Viewport | Modify |
| `packages/extension/src/sidepanel/components/chat/Markdown.tsx` | Streamdown wrapper, all markdown config in one place | Create |
| `packages/extension/src/sidepanel/components/chat/MessageList.tsx` | Virtualized list + stick-to-bottom + jump button | Create |
| `packages/extension/src/sidepanel/components/chat/ChatView.tsx` | Delegate message rendering to `MessageList` | Modify |
| `packages/extension/src/demo/mock.ts` | Markdown-rich canned replies + long-conversation seed | Modify |
| `packages/extension/src/demo/Demo.tsx` | Add a "Long" demo state | Modify |
| `packages/extension/src/demo/preview.tsx` | Seed the long conversation for the "Long" state | Modify |
| `packages/extension/manifest.json` | `wasm-unsafe-eval` CSP for Shiki's WASM engine | Modify |

---

## Task 1: Install dependencies

**Files:**
- Modify: `packages/extension/package.json`

- [ ] **Step 1: Add the dependencies**

From `packages/extension`, run:

```bash
bun add @tanstack/react-virtual streamdown @streamdown/code
```

Expected: `package.json` `dependencies` gains `@tanstack/react-virtual`, `streamdown`, and `@streamdown/code`; `shiki` is pulled in transitively. `bun install` completes without error.

- [ ] **Step 2: Confirm the packages resolved**

Run:

```bash
ls -d node_modules/@tanstack/react-virtual ../../node_modules/streamdown ../../node_modules/@streamdown/code 2>/dev/null; \
ls -d node_modules/streamdown node_modules/@streamdown/code 2>/dev/null
```

Expected: at least one path prints for each of `streamdown`, `@streamdown/code`, and `@tanstack/react-virtual`. **Note which directory `streamdown` landed in** (workspace-root `../../node_modules/streamdown` when hoisted, or `node_modules/streamdown` inside the package) — Task 2 needs it.

- [ ] **Step 3: Verify the existing build still typechecks**

Run:

```bash
bun run typecheck
```

Expected: PASS (no errors). The new deps are not imported yet, so nothing should change.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/package.json ../../bun.lock 2>/dev/null || git add packages/extension/package.json
git commit -m "build(extension): add streamdown, @streamdown/code, @tanstack/react-virtual"
```

(If the lockfile is named differently, `git add -A` the lockfile too. Do not commit unrelated working-tree changes — stage only `package.json` and the lockfile.)

---

## Task 2: Wire Streamdown into Tailwind

**Files:**
- Modify: `packages/extension/src/sidepanel/index.css`

Streamdown styles its output with Tailwind utility classes, so Tailwind v4 must scan Streamdown's `dist` for class names (`@source`), and Streamdown's animation keyframes must be imported (`streamdown/styles.css`).

- [ ] **Step 1: Determine the correct `@source` path**

The `@source` path is resolved **relative to `index.css`** (`packages/extension/src/sidepanel/`). Run from `packages/extension`:

```bash
test -d ../../node_modules/streamdown && echo "ROOT: use ../../../../node_modules/streamdown/dist/*.js"
test -d node_modules/streamdown && echo "LOCAL: use ../../node_modules/streamdown/dist/*.js"
```

Use the path from whichever line prints. If both print, prefer the `ROOT` path.

- [ ] **Step 2: Add the import and source directive**

Edit `packages/extension/src/sidepanel/index.css`. The top of the file is currently:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@fontsource-variable/inter";
```

Change it to (using the `@source` path chosen in Step 1 — the `ROOT` variant shown here):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@fontsource-variable/inter";
@import "streamdown/styles.css";

@source "../../../../node_modules/streamdown/dist/*.js";
```

- [ ] **Step 3: Verify the dev build compiles the CSS**

Run:

```bash
bun run build
```

Expected: build succeeds. (Streamdown classes are now generated even though nothing renders markdown yet — this just proves the `@source`/import paths resolve.)

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/sidepanel/index.css
git commit -m "build(extension): scan streamdown for Tailwind classes + its styles"
```

---

## Task 3: Pure stick-to-bottom helper (TDD)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/autoscroll.ts`
- Test: `packages/extension/test/autoscroll.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/autoscroll.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { isNearBottom, STICK_THRESHOLD } from "../src/sidepanel/lib/autoscroll.ts";

describe("isNearBottom", () => {
  test("exactly at the bottom is near", () => {
    // scrollHeight 1000, viewport 400, scrolled to the end (600)
    expect(isNearBottom(600, 400, 1000)).toBe(true);
  });

  test("within the threshold is near", () => {
    // 30px from the bottom (< 64)
    expect(isNearBottom(570, 400, 1000)).toBe(true);
  });

  test("exactly at the threshold is near", () => {
    // 64px from the bottom
    expect(isNearBottom(536, 400, 1000)).toBe(true);
  });

  test("beyond the threshold is not near", () => {
    // 100px from the bottom (> 64)
    expect(isNearBottom(500, 400, 1000)).toBe(false);
  });

  test("content shorter than the viewport is near", () => {
    // nothing to scroll → distance is negative → near
    expect(isNearBottom(0, 400, 200)).toBe(true);
  });

  test("respects a custom threshold", () => {
    // 100px from the bottom, threshold 120
    expect(isNearBottom(500, 400, 1000, 120)).toBe(true);
  });

  test("exposes a default threshold constant", () => {
    expect(STICK_THRESHOLD).toBe(64);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test test/autoscroll.test.ts
```

Expected: FAIL — module `../src/sidepanel/lib/autoscroll.ts` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/extension/src/sidepanel/lib/autoscroll.ts`:

```ts
/**
 * Pure stick-to-bottom logic for the virtualized chat list. Kept free of DOM
 * and React so the bottom-tracking decision can be unit-tested (this repo tests
 * logic, not React rendering).
 */

/** How close (px) to the bottom still counts as "pinned to the bottom". */
export const STICK_THRESHOLD = 64;

/**
 * True when the scroll position is within `threshold` px of the bottom — i.e.
 * the user is effectively at the latest message, so the list should keep
 * auto-scrolling as new content streams in. Content shorter than the viewport
 * (nothing to scroll) counts as near the bottom.
 */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = STICK_THRESHOLD,
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test test/autoscroll.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/sidepanel/lib/autoscroll.ts packages/extension/test/autoscroll.test.ts
git commit -m "feat(extension): add isNearBottom stick-to-bottom helper"
```

---

## Task 4: Forward a viewport ref from ScrollArea

**Files:**
- Modify: `packages/extension/src/sidepanel/components/ui/scroll-area.tsx`

The virtualizer needs the actual scrolling DOM node. base-ui's `ScrollArea.Viewport` is that node; expose a `viewportRef` prop that forwards to it.

- [ ] **Step 1: Add the `viewportRef` prop**

In `packages/extension/src/sidepanel/components/ui/scroll-area.tsx`, change the `ScrollArea` function signature. Current:

```tsx
export function ScrollArea({
  className,
  children,
  scrollFade = false,
  scrollbarGutter = false,
  fill = false,
  clampContentMinWidth = true,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  scrollbarGutter?: boolean;
  fill?: boolean;
  clampContentMinWidth?: boolean;
}): React.ReactElement {
```

Change to:

```tsx
export function ScrollArea({
  className,
  children,
  scrollFade = false,
  scrollbarGutter = false,
  fill = false,
  clampContentMinWidth = true,
  viewportRef,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  scrollbarGutter?: boolean;
  fill?: boolean;
  clampContentMinWidth?: boolean;
  viewportRef?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
```

- [ ] **Step 2: Attach the ref to the Viewport**

In the same file, find:

```tsx
      <ScrollAreaPrimitive.Viewport
        className={cn(
```

Change the opening tag to add the ref:

```tsx
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn(
```

- [ ] **Step 3: Verify typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS. (`React` is already imported as a type in this file.)

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/sidepanel/components/ui/scroll-area.tsx
git commit -m "feat(extension): forward viewportRef through ScrollArea"
```

---

## Task 5: Markdown component (Streamdown wrapper)

**Files:**
- Create: `packages/extension/src/sidepanel/components/chat/Markdown.tsx`

- [ ] **Step 1: Create the component**

Create `packages/extension/src/sidepanel/components/chat/Markdown.tsx`:

```tsx
/**
 * Renders assistant message text as markdown via Streamdown. The single place
 * markdown is configured: Shiki highlighting (the opt-in `code` plugin only —
 * mermaid/math stay out of the bundle), incomplete-markdown hardening for
 * streaming, and a className that tunes typographic rhythm to our design tokens
 * for the narrow side panel.
 */
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { cn } from "@/lib/utils";

// Prose rhythm + token mapping. Code blocks (`pre`) are left to the Shiki plugin
// (it sets the themed background); we only constrain inline code, links, lists,
// tables (which must scroll horizontally in a narrow panel), and spacing.
const PROSE = cn(
  "text-sm leading-relaxed text-foreground break-words [overflow-wrap:anywhere]",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-80",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:text-xs",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_table]:my-2 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-xs",
  "[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-3 [&_hr]:border-border",
);

export function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown
      plugins={{ code }}
      isAnimating={streaming}
      parseIncompleteMarkdown
      controls
      shikiTheme={["github-light", "github-dark"]}
      className={PROSE}
    >
      {text}
    </Streamdown>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS. If Streamdown's types reject the `shikiTheme` tuple, widen it (`shikiTheme={["github-light", "github-dark"] as const}`) or drop the prop to use its default (`['github-light','github-dark']`). If `controls`/`isAnimating`/`parseIncompleteMarkdown` are not recognized props in the installed version, remove the unknown one — the defaults already match our intent (`parseIncompleteMarkdown` and `controls` default on).

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/Markdown.tsx
git commit -m "feat(extension): Markdown component wrapping Streamdown + Shiki"
```

---

## Task 6: Virtualized MessageList

**Files:**
- Create: `packages/extension/src/sidepanel/components/chat/MessageList.tsx`

- [ ] **Step 1: Create the component**

Create `packages/extension/src/sidepanel/components/chat/MessageList.tsx`:

```tsx
/**
 * The virtualized transcript. Owns the TanStack virtualizer (hosted in the
 * existing base-ui ScrollArea via a forwarded viewport ref), dynamic row
 * measurement (markdown/code heights vary), stick-to-bottom auto-scroll during
 * streaming, and a floating jump-to-bottom button when the user scrolls away.
 *
 * User rows stay plain text; assistant rows render markdown. Spacing between
 * rows lives in per-row padding (`pb-4`) because flex `gap` does not survive the
 * absolute positioning the virtualizer requires.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { isNearBottom } from "@/lib/autoscroll";
import type { UiMessage } from "./types";
import { Markdown } from "./Markdown";
import { MessageActions } from "./primitives";
import { Icon } from "./icons";

const WRAP = "whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

export function MessageList({ messages, streaming }: { messages: UiMessage[]; streaming: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 80,
    overscan: 6,
    getItemKey: (index) => messages[index]!.id,
  });

  // Track whether the user is pinned to the bottom (drives auto-scroll + the
  // jump button). Bound once to the viewport node the ScrollArea forwards.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
      setStick(near);
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Re-pin to the bottom while sticking. Fires on a new message and on each
  // streamed token (the last row's text — and thus measured height — grows).
  const lastText = messages[messages.length - 1]?.text ?? "";
  useLayoutEffect(() => {
    if (!stick || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length, lastText, stick, virtualizer]);

  const jumpToBottom = () => {
    setStick(true);
    setAtBottom(true);
    if (messages.length > 0) virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  };

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea viewportRef={viewportRef}>
        <div className="mx-auto w-full max-w-2xl px-3 py-4">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const m = messages[item.index]!;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-4"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {m.role === "user" ? (
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
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      {!atBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent"
        >
          <Icon name="chevronDown" size={14} />
          {streaming ? "New messages" : "Jump to latest"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/MessageList.tsx
git commit -m "feat(extension): virtualized MessageList with stick-to-bottom + jump button"
```

---

## Task 7: Use MessageList in ChatView

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/ChatView.tsx`

- [ ] **Step 1: Import MessageList and drop the now-unused imports**

In `packages/extension/src/sidepanel/components/chat/ChatView.tsx`, the top imports are:

```tsx
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatViewProps } from "./types";
import { Icon } from "./icons";
import { IconButton, MessageActions, ModelPicker, Picker, SuggestionChip } from "./primitives";
import { ProviderIcon } from "./ProviderIcon";
```

Replace them with (drops `useEffect`/`useRef`, `ScrollArea`, `MessageActions`; adds `MessageList`; keeps `cn` — still used for the error line):

```tsx
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatViewProps } from "./types";
import { Icon } from "./icons";
import { IconButton, ModelPicker, Picker, SuggestionChip } from "./primitives";
import { ProviderIcon } from "./ProviderIcon";
import { MessageList } from "./MessageList";
```

- [ ] **Step 2: Remove the scroll ref and effect**

Delete the `bottomRef` declaration (currently `const bottomRef = useRef<HTMLDivElement>(null);`) and the auto-scroll effect:

```tsx
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);
```

So the top of the component body becomes:

```tsx
  const [input, setInput] = useState("");
  const canSend = input.trim().length > 0 && !streaming;

  function submit() {
    if (!canSend) return;
    onSend(input.trim());
    setInput("");
  }
```

- [ ] **Step 3: Replace the message-list block**

Replace the entire non-empty branch — currently:

```tsx
      ) : (
        <div className="min-h-0 flex-1">
          <ScrollArea>
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className={cn(WRAP, "max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-sm")}>
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="group">
                    <div className={cn(WRAP, "text-sm leading-relaxed")}>
                      {m.text}
                      {m.streaming && (
                        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
                      )}
                    </div>
                    {!m.streaming && m.text && (
                      <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <MessageActions text={m.text} />
                      </div>
                    )}
                  </div>
                ),
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </div>
      )}
```

with:

```tsx
      ) : (
        <MessageList messages={messages} streaming={streaming} />
      )}
```

- [ ] **Step 4: Verify typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS. The `WRAP` constant at the top of the file is still used by the error line (`error && <p className={cn(WRAP, ...)}>`), so leave it. If typecheck reports `WRAP` or any import as unused, that's only a warning-level concern (the project does not set `noUnusedLocals`); remove anything genuinely unused.

- [ ] **Step 5: Run the full test + typecheck suite**

Run:

```bash
bun test && bun run typecheck
```

Expected: all tests PASS, typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/ChatView.tsx
git commit -m "feat(extension): render chat via virtualized MessageList"
```

---

## Task 8: Demo markdown + long conversation

**Files:**
- Modify: `packages/extension/src/demo/mock.ts`
- Modify: `packages/extension/src/demo/Demo.tsx`
- Modify: `packages/extension/src/demo/preview.tsx`

- [ ] **Step 1: Make canned replies markdown-rich and add a long conversation**

In `packages/extension/src/demo/mock.ts`, replace the `cannedReplies` export (the last export in the file) with:

```ts
/** Canned assistant replies for the demo's fake streaming — exercise markdown. */
export const cannedReplies = [
  "Good question. Here's the **short version**: keep the interface focused and let the content breathe.\n\n- Identify the goal\n- Gather what you need\n- Iterate quickly\n\nThen check the result against the original ask.",
  "Here's how I'd implement it:\n\n```ts\nexport function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {\n  let t: ReturnType<typeof setTimeout>;\n  return (...args: Parameters<T>) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}\n```\n\nUse a leading edge if you want the first call to fire immediately.",
  "Quick comparison of the options:\n\n| Option | Bundle | Streaming |\n| --- | --- | --- |\n| Streamdown | Larger | Built-in |\n| react-markdown | Smaller | Manual |\n\nInline code like `npm i streamdown` and a [link](https://streamdown.ai) should both render. This longer paragraph also checks that wrapping and auto-scroll behave while the message streams in.",
];

/** A long thread to exercise list virtualization in the playground. */
export const longConversation: UiMessage[] = Array.from({ length: 40 }, (_, i): UiMessage => {
  const n = i + 1;
  return i % 2 === 0
    ? { id: `long-u-${n}`, role: "user", text: `Question ${n}: can you explain step ${n}?` }
    : {
        id: `long-a-${n}`,
        role: "assistant",
        text: `Sure — step ${n} in **three parts**:\n\n1. Set up the input\n2. Apply the transform\n3. Verify the output\n\n\`\`\`ts\nconst step${n} = (x: number) => x * ${n};\n\`\`\``,
      };
});
```

Also enrich the existing `sampleConversation` so the default "Conversation" state shows markdown. Replace the `m4` assistant entry's `text` value with:

```ts
    text:
      "Chrome extensions… the usual suspects. Let's try this:\n\n1. **Disable** unnecessary extensions\n2. Clear the browser cache\n3. Restart your laptop\n\nAlso check disk space — see the [cleanup guide](https://support.example.com/disk-cleanup/a-very-long-path-that-should-wrap-instead-of-overflowing-the-panel).",
```

- [ ] **Step 2: Add a "Long" state to the playground controls**

In `packages/extension/src/demo/Demo.tsx`, change the `State` type:

```tsx
type State = "empty" | "chat";
```

to:

```tsx
type State = "empty" | "chat" | "long";
```

Then in the `State` segment options, change:

```tsx
              options={[
                ["empty", "Empty"],
                ["chat", "Conversation"],
              ]}
```

to:

```tsx
              options={[
                ["empty", "Empty"],
                ["chat", "Conversation"],
                ["long", "Long (virtualized)"],
              ]}
```

- [ ] **Step 3: Seed the long conversation in the preview**

In `packages/extension/src/demo/preview.tsx`, update the import:

```tsx
import { mockConversations, providerEntries, sampleConversation } from "./mock";
```

to:

```tsx
import { longConversation, mockConversations, providerEntries, sampleConversation } from "./mock";
```

Then change `ChatScreen`:

```tsx
function ChatScreen() {
  const chat = useDemoChat(state === "chat" ? sampleConversation : []);
  return <ChatView {...chat} onManageProviders={() => navTo("manage")} />;
}
```

to:

```tsx
function ChatScreen() {
  const initial = state === "long" ? longConversation : state === "chat" ? sampleConversation : [];
  const chat = useDemoChat(initial);
  return <ChatView {...chat} onManageProviders={() => navTo("manage")} />;
}
```

- [ ] **Step 4: Verify typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Visually verify in the playground**

Run:

```bash
bun run dev
```

Then open the printed local URL and check:
- **State = Conversation:** assistant replies render markdown (bold, list, link); code blocks are highlighted with a copy button; the long URL wraps without horizontal overflow at 300px width.
- **State = Long (virtualized):** scrolling is smooth; inspect the DOM and confirm only a window of rows (roughly the visible count + `overscan` 6) exists in `.relative` spacer at any time, not all 40.
- **Streaming:** type a message and send; the reply streams, markdown renders progressively, the list stays pinned to the bottom. Scroll up mid-stream → the **jump-to-bottom** pill appears ("New messages"); click it → re-pins.
- Toggle **Theme = Dark** and confirm code blocks and text use the dark theme.

Stop the dev server (Ctrl-C) when done.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/demo/mock.ts packages/extension/src/demo/Demo.tsx packages/extension/src/demo/preview.tsx
git commit -m "demo: markdown-rich replies + long-conversation virtualization state"
```

---

## Task 9: CSP for Shiki's WASM engine

**Files:**
- Modify: `packages/extension/manifest.json`

Shiki v3 defaults to a WebAssembly (oniguruma) regex engine. The MV3 default CSP for extension pages (`script-src 'self'`) blocks WASM compilation, so the **side panel** (not the Vite playground, which runs under normal web CSP) would throw a CSP error and code highlighting would fail. Add `wasm-unsafe-eval` (permits WASM compile only — not arbitrary `eval`).

- [ ] **Step 1: Add the content security policy**

In `packages/extension/manifest.json`, add a top-level `content_security_policy` key (e.g. after the `"side_panel"` block). Current tail:

```json
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  }
}
```

Change to:

```json
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

- [ ] **Step 2: Build the extension**

Run:

```bash
bun run build
```

Expected: build succeeds and emits the extension to the build output dir.

- [ ] **Step 3: Load and verify in Chrome (manual)**

Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → the build output dir), open the side panel, and run a chat turn that returns a fenced code block.

Expected: code is syntax-highlighted; the side-panel DevTools console shows **no** `Content Security Policy` / `WebAssembly` violation.

If the console shows **no** WASM error even **without** this CSP line (i.e. `@streamdown/code` ships a JS regex engine), the `content_security_policy` block is unnecessary — revert this task's change to keep the manifest minimal. If highlighting works only **with** the line, keep it.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/manifest.json
git commit -m "build(extension): allow wasm-unsafe-eval for Shiki highlighting"
```

---

## Final verification

- [ ] **Run the full suite**

```bash
bun test && bun run typecheck && bun run build
```

Expected: all tests PASS, typecheck PASS, build succeeds.

- [ ] **Confirm against the spec**
  - Assistant messages render markdown with highlighted code + copy button ✅ (Tasks 5, 8)
  - User messages stay plain text ✅ (Task 6)
  - List is virtualized inside base-ui ScrollArea ✅ (Tasks 4, 6)
  - Stick-to-bottom + jump-to-bottom button ✅ (Tasks 3, 6)
  - Streaming renders progressive markdown, no manual cursor ✅ (Tasks 5, 6)
  - CSP resolved for Shiki WASM ✅ (Task 9)

---

## Notes / gotchas for the implementer

- **`verbatimModuleSyntax` is on** → type-only imports must use `import type` (already done for `UiMessage` and `ChatViewProps`).
- **Bun working dir:** the shell's directory persists between commands; ensure you're in `packages/extension` before running `bun` scripts.
- **base-ui Viewport is a native scroll element** (custom-styled scrollbar overlay), so `scrollTop`/`clientHeight`/`scrollHeight` and the `scroll` event behave normally for the virtualizer and `isNearBottom`.
- **Streamdown prop drift:** versions move fast. If a prop name in Task 5 is rejected by the installed types, prefer the documented default behavior over inventing a prop — `parseIncompleteMarkdown` and `controls` default on, and `shikiTheme` defaults to `['github-light','github-dark']`.
- **The playground will not surface the CSP issue** (it runs under web CSP, not extension CSP) — Task 9's verification must be done in the loaded extension.
