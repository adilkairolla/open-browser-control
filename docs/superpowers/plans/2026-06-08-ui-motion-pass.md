# Extension UI Motion Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cohesive, "balanced with light delight" motion layer across the Chrome-extension chat side panel (drawer, tool calls, messages, approval card, composer, buttons, empty state, pickers) plus light polish to the in-page agent indicator, following Emil Kowalski's design-engineering principles.

**Architecture:** CSS-first. Define Emil's easing/duration tokens once and drive the high-frequency, predetermined animations (press feedback, hover, chevron, tool expand, status pops, stagger, message fade-in) with **CSS** — off the main thread, interruptible, cheap, and unaffected by the constant token-streaming that keeps the main thread busy. Reach for the **`motion`** library only where CSS is genuinely awkward: **exit animations on React unmount** (the conversations drawer, the tool-approval card). The in-page indicator stays pure DOM/CSS (no React / no library) per the existing performance design and the `avoid-fullscreen-backdrop-filter` memory.

**Tech Stack:** React 19, Tailwind v4 (`@theme` / `@utility`), `@base-ui/react`, `motion` (new), `tw-animate-css` (already present), Vite. Tests: `bun test` + `happy-dom`. Visual review via the Vite demo playground (`bun run dev`).

**Key constraints (do not violate):**
- The `MessageList` virtualizer positions rows with `transform: translateY()` on the measured row element. **Never** animate row height or that positioning transform. Entrance animation goes on an **inner** wrapper (opacity + tiny translate only) so measurement and stick-to-bottom auto-scroll stay correct.
- Animations are predominantly visual; unit tests cover only the **extractable pure logic** (motion tokens, the `SeenSet` entrance guard, the indicator ripple keyframe). Everything else is verified in the demo playground (Emil's "review in slow motion" step) — each task says exactly what to look at.
- Honor `prefers-reduced-motion` globally.

**Conventions used below:**
- Run tests from the extension package: `cd packages/extension && bun test test/<file>.test.ts`.
- Typecheck: `cd packages/extension && bun run typecheck`.
- Visual review: `cd packages/extension && bun run dev`, then open the playground (default `http://localhost:5173/`) or a screen directly via `http://localhost:5173/preview.html?screen=<screen>&state=<state>&theme=<light|dark>`.
- Emil's curves: `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`, `--ease-drawer: cubic-bezier(0.32,0.72,0,1)`. Spring for delight: `{ duration: 0.4, bounce: 0.18 }`.

---

## File Structure

**Create:**
- `packages/extension/src/sidepanel/lib/motion.ts` — shared motion constants (easing arrays, spring) + `prefersReducedMotion()`. One responsibility: motion config consumed by `motion`-driven components.
- `packages/extension/src/sidepanel/lib/seen.ts` — `SeenSet`, the pure "have I shown this id before?" guard for one-shot entrance animations.
- `packages/extension/test/motion.test.ts` — tests for `lib/motion.ts`.
- `packages/extension/test/seen.test.ts` — tests for `lib/seen.ts`.

**Modify:**
- `packages/extension/src/sidepanel/index.css` — motion tokens, keyframes, utilities, reduced-motion base.
- `packages/extension/src/sidepanel/components/chat/primitives.tsx` — press feedback (`IconButton`, `SuggestionChip`), copy pop (`MessageActions`), Combobox popup easing.
- `packages/extension/src/sidepanel/components/chat/MessageList.tsx` — message entrance via `SeenSet`.
- `packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx` — grid expand, pill entrance, status pop.
- `packages/extension/src/sidepanel/components/chat/ConversationsDrawer.tsx` — `motion` enter/exit.
- `packages/extension/src/sidepanel/components/chat/ToolApprovalCard.tsx` — `motion` enter/exit.
- `packages/extension/src/sidepanel/App.tsx` — `AnimatePresence` wrapper for the approval card.
- `packages/extension/src/sidepanel/components/chat/ChatView.tsx` — send⇄stop morph, empty-state stagger, approval-card `AnimatePresence` is in App (ChatView only renders `composerTop`).
- `packages/extension/src/sidepanel/components/ui/select.tsx` — select popup easing.
- `packages/extension/src/sidepanel/components/ui/tooltip.tsx` — tooltip popup transition + provider delay.
- `packages/extension/src/control/indicator/dom.ts` — ripple keyframe polish.
- `packages/extension/test/indicatorDom.test.ts` — update ripple assertion.
- `packages/extension/src/demo/preview.tsx` + `packages/extension/src/demo/Demo.tsx` — `AnimatePresence` around demo approval card + a "Motion" showcase screen.
- `packages/extension/package.json` — add `motion` dependency (via `bun add`).

---

## Task 1: Install `motion`, add motion tokens + reduced-motion, create `lib/motion.ts`

**Files:**
- Modify: `packages/extension/package.json` (via `bun add`)
- Modify: `packages/extension/src/sidepanel/index.css`
- Create: `packages/extension/src/sidepanel/lib/motion.ts`
- Test: `packages/extension/test/motion.test.ts`

- [ ] **Step 1: Install the `motion` library**

Run:
```bash
cd packages/extension && bun add motion
```
Expected: `motion` appears under `dependencies` in `packages/extension/package.json`.

- [ ] **Step 2: Write the failing test for `lib/motion.ts`**

Create `packages/extension/test/motion.test.ts`:
```ts
import { afterEach, describe, expect, test } from "bun:test";
import { EASE_DRAWER, EASE_IN_OUT, EASE_OUT, SPRING, prefersReducedMotion } from "../src/sidepanel/lib/motion.ts";

describe("motion tokens", () => {
  test("easing curves are Emil's cubic-bezier control points", () => {
    expect(EASE_OUT).toEqual([0.23, 1, 0.32, 1]);
    expect(EASE_IN_OUT).toEqual([0.77, 0, 0.175, 1]);
    expect(EASE_DRAWER).toEqual([0.32, 0.72, 0, 1]);
  });

  test("spring is a subtle Apple-style spring", () => {
    expect(SPRING).toEqual({ type: "spring", duration: 0.4, bounce: 0.18 });
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => {
    delete (globalThis as any).matchMedia;
  });

  test("false when matchMedia is unavailable", () => {
    delete (globalThis as any).matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  test("reflects the media query result", () => {
    (globalThis as any).matchMedia = (q: string) => ({ matches: q.includes("reduce") });
    expect(prefersReducedMotion()).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/extension && bun test test/motion.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/motion.ts`.

- [ ] **Step 4: Create `lib/motion.ts`**

Create `packages/extension/src/sidepanel/lib/motion.ts`:
```ts
/**
 * Shared motion configuration for the `motion`-driven components (the
 * conversations drawer and the tool-approval card). Everything else animates in
 * CSS via the tokens/utilities in `index.css`; this file only exists for the
 * places where React unmount-exit animations need JS.
 *
 * Curves come from Emil Kowalski's design-engineering guidance: the built-in CSS
 * easings are too weak, so we use stronger custom variants. `motion` accepts a
 * 4-number array as a cubic-bezier `ease`.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const; // enter/exit workhorse
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const; // on-screen movement
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const; // iOS-like drawer

/** Subtle Apple-style spring for the few "delight" moments. */
export const SPRING = { type: "spring", duration: 0.4, bounce: 0.18 } as const;

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/extension && bun test test/motion.test.ts`
Expected: PASS (5 assertions across the cases).

- [ ] **Step 6: Add motion tokens, keyframes, utilities, and reduced-motion base to `index.css`**

In `packages/extension/src/sidepanel/index.css`, add the three easing custom properties to the existing `:root` block (after the `--success-foreground` line, before the closing `}` at line 35):
```css
  /* Motion — Emil's stronger custom easing curves (built-ins are too weak). */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Then append the following to the **end** of `index.css` (after the `scrollbar-thin` utility):
```css
/* ── Motion ───────────────────────────────────────────────────────────────
   CSS-driven, off-main-thread animations. Keep transforms/opacity only.
   Durations stay under 300ms for UI; ease-out for enter, per Emil's framework. */

@keyframes obc-msg-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes obc-tool-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes obc-fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes obc-pop {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Message enters once, from just below, fading up. */
@utility animate-msg-in {
  animation: obc-msg-in 260ms var(--ease-out) both;
}
/* A tool pill settling into the transcript. */
@utility animate-tool-in {
  animation: obc-tool-in 220ms var(--ease-out) both;
}
/* Empty-state / staggered list items. Pair with inline animation-delay. */
@utility animate-fade-up {
  animation: obc-fade-up 300ms var(--ease-out) both;
}
/* A small confirming pop for status / icon swaps (never from scale(0)). */
@utility animate-pop {
  animation: obc-pop 180ms var(--ease-out) both;
}

/* Press feedback for any pressable element. */
@utility press {
  transition: transform 140ms var(--ease-out);
  &:active {
    transform: scale(0.97);
  }
}

/* Accessibility: reduce motion globally. Movement is removed; the near-instant
   timings keep the UI functional without the gentle transforms. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 7: Verify the build still compiles the CSS**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS (no TS errors). CSS validity is exercised in the demo in later tasks.

- [ ] **Step 8: Commit**

```bash
git add packages/extension/package.json packages/extension/bun.lock packages/extension/src/sidepanel/lib/motion.ts packages/extension/test/motion.test.ts packages/extension/src/sidepanel/index.css
git commit -m "feat(extension): add motion library, easing tokens, and animation utilities"
```

---

## Task 2: Press feedback on pressable elements (CSS)

Gives every pressable a `scale(0.97)` on `:active` so the UI feels like it's listening. Uses the `press` utility from Task 1.

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/primitives.tsx:50-59` (IconButton class), `:67-77` (SuggestionChip)
- Modify: `packages/extension/src/sidepanel/components/chat/ToolApprovalCard.tsx:51-75` (the three buttons)
- Modify: `packages/extension/src/sidepanel/components/chat/MessageList.tsx:117-124` (jump-to-bottom button)

- [ ] **Step 1: Add `press` to `IconButton`**

In `primitives.tsx`, the `IconButton` `cn(...)` (line 50) currently starts with:
```tsx
          "inline-flex shrink-0 items-center justify-center rounded-lg outline-none transition-colors",
```
Change to:
```tsx
          "press inline-flex shrink-0 items-center justify-center rounded-lg outline-none transition-colors",
```

- [ ] **Step 2: Add `press` to `SuggestionChip`**

In `primitives.tsx`, `SuggestionChip` (line 71) class string:
```tsx
      className="rounded-2xl border bg-card px-3 py-2 text-left text-sm text-foreground/90 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
```
Change to (prepend `press`):
```tsx
      className="press rounded-2xl border bg-card px-3 py-2 text-left text-sm text-foreground/90 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
```

- [ ] **Step 3: Add `press` to the three approval buttons**

In `ToolApprovalCard.tsx`, prepend `press ` to the `className` of each of the three `<button>`s (the Deny button at line 54, Allow-once at line 61, and the "always allow" at line 70). For example the Deny button becomes:
```tsx
            className="press h-8 flex-1 rounded-lg border text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
```
Apply the same `press ` prefix to the Allow-once and always-allow buttons.

- [ ] **Step 4: Add `press` to the jump-to-bottom button**

In `MessageList.tsx` (line 119), the button class:
```tsx
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent"
```
becomes:
```tsx
          className="press absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent"
```
Note: this button already has `-translate-x-1/2` for centering. The `press` utility's `:active { transform: scale(0.97) }` will override `transform` while pressed, momentarily dropping the centering offset and causing a 1px horizontal jump. To avoid that, instead of `press` here use an explicit class that preserves the translate:
```tsx
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-accent active:scale-[0.97] active:-translate-x-1/2"
```
(Keeping `-translate-x-1/2` in the `:active` state — Tailwind composes both transforms.)

- [ ] **Step 5: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Visual verification**

Run: `cd packages/extension && bun run dev`. Open `http://localhost:5173/preview.html?screen=chat&state=tools`.
Confirm: pressing (mouse-down) the send button, attach button, header icons, suggestion chips (use `state=empty`), and the approval buttons produces a subtle, fast scale-down that springs back on release. The jump-to-bottom button (scroll up in `state=long`) stays centered while pressed.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/primitives.tsx packages/extension/src/sidepanel/components/chat/ToolApprovalCard.tsx packages/extension/src/sidepanel/components/chat/MessageList.tsx
git commit -m "feat(extension): add press feedback to pressable elements"
```

---

## Task 3: Message entrance animation (SeenSet + one-shot fade-up)

New messages fade up once. Old messages don't re-animate when scrolled back into view (the virtualizer remounts rows). The initial transcript does not animate (only messages that arrive after mount).

**Files:**
- Create: `packages/extension/src/sidepanel/lib/seen.ts`
- Test: `packages/extension/test/seen.test.ts`
- Modify: `packages/extension/src/sidepanel/components/chat/MessageList.tsx`

- [ ] **Step 1: Write the failing test for `SeenSet`**

Create `packages/extension/test/seen.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { SeenSet } from "../src/sidepanel/lib/seen.ts";

describe("SeenSet", () => {
  test("ids seeded at construction are not new", () => {
    const seen = new SeenSet(["a", "b"]);
    expect(seen.isNew("a")).toBe(false);
    expect(seen.isNew("b")).toBe(false);
  });

  test("an unseen id is new", () => {
    const seen = new SeenSet(["a"]);
    expect(seen.isNew("c")).toBe(true);
  });

  test("isNew is a pure query — it does not record", () => {
    const seen = new SeenSet();
    expect(seen.isNew("x")).toBe(true);
    expect(seen.isNew("x")).toBe(true);
  });

  test("remember makes ids no longer new", () => {
    const seen = new SeenSet();
    expect(seen.isNew("x")).toBe(true);
    seen.remember(["x", "y"]);
    expect(seen.isNew("x")).toBe(false);
    expect(seen.isNew("y")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/extension && bun test test/seen.test.ts`
Expected: FAIL — cannot resolve `../src/sidepanel/lib/seen.ts`.

- [ ] **Step 3: Create `lib/seen.ts`**

Create `packages/extension/src/sidepanel/lib/seen.ts`:
```ts
/**
 * Tracks which ids have already been shown, so a one-shot entrance animation
 * fires exactly once per item — even though the transcript virtualizer remounts
 * row DOM as it scrolls. `isNew` is a pure query (safe to call during render);
 * call `remember` in an effect after commit to record what was shown.
 *
 * Seed the constructor with the ids present at mount so the initial transcript
 * does not animate; only ids that arrive later are "new".
 */
export class SeenSet {
  private seen: Set<string>;

  constructor(initial: Iterable<string> = []) {
    this.seen = new Set(initial);
  }

  isNew(id: string): boolean {
    return !this.seen.has(id);
  }

  remember(ids: Iterable<string>): void {
    for (const id of ids) this.seen.add(id);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/extension && bun test test/seen.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Wire `SeenSet` into `MessageList`**

In `MessageList.tsx`:

(a) Add the import after the existing `import { Icon } from "./icons";` (line 20):
```tsx
import { SeenSet } from "@/lib/seen";
```

(b) Inside `MessageList`, after the `lastTopRef` declaration (line 28), add the seen-set ref seeded with the current message ids (lazy, runs once):
```tsx
  // One-shot entrance guard: seed with the ids present at mount so the initial
  // transcript doesn't animate — only messages that arrive later fade up.
  // Null-then-lazy-init pattern matches the codebase's useRef usage.
  const seenRef = useRef<SeenSet | null>(null);
  if (!seenRef.current) seenRef.current = new SeenSet(messages.map((m) => m.id));
```

(c) After the `totalSize` layout effect (after line 67), add an effect that records ids once they've rendered:
```tsx
  // Record ids after commit so each message's entrance animation fires once.
  useEffect(() => {
    seenRef.current?.remember(messages.map((m) => m.id));
  }, [messages]);
```

(d) In the virtual-item map, compute whether the row is entering and wrap the row's children in an inner div that carries the animation (so the virtualizer's positioning `transform` on the outer row stays untouched). Replace the row body (lines 80-109) with:
```tsx
            {virtualizer.getVirtualItems().map((item) => {
              const m = messages[item.index]!;
              const entering = seenRef.current!.isNew(m.id);
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-4"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div className={entering ? "animate-msg-in" : undefined}>
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
                  </div>
                </div>
              );
            })}
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Visual verification**

Run the demo (`bun run dev`), open `http://localhost:5173/preview.html?screen=chat&state=chat`.
Confirm:
1. On load, the existing transcript appears **without** a fade cascade (initial messages are seeded as seen).
2. Send a message (type + Enter in the composer) — the new user bubble and the streaming assistant reply each fade up once (~260ms), from ~6px below.
3. In `state=long`, scroll up and back down — already-seen messages do **not** re-animate, and stick-to-bottom auto-scroll during streaming still pins to the bottom (no jitter/jump).

- [ ] **Step 8: Commit**

```bash
git add packages/extension/src/sidepanel/lib/seen.ts packages/extension/test/seen.test.ts packages/extension/src/sidepanel/components/chat/MessageList.tsx
git commit -m "feat(extension): one-shot fade-up entrance for new messages"
```

---

## Task 4: ToolCallCard — grid expand, pill entrance, status pop

Animate the expand/collapse (CSS grid-rows `0fr↔1fr`, no `height: auto` hack), give the pill a settle-in entrance, and pop the status icon when a tool finishes.

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx`

- [ ] **Step 1: Pop the status icon on completion**

In `ToolCallCard.tsx`, replace the `StatusIcon` component (lines 22-26) so that the success/error icon mounts with a pop (the running spinner is untouched). The `key` forces a remount when status changes so the animation retriggers:
```tsx
function StatusIcon({ status }: { status: ToolCallView["status"] }) {
  if (status === "running") return <Spinner className="size-3.5 text-muted-foreground" />;
  if (status === "error")
    return <Icon key="error" name="close" size={14} className="animate-pop text-destructive" />;
  return <Icon key="ok" name="check" size={14} className="animate-pop text-success" />;
}
```

- [ ] **Step 2: Add the pill settle-in entrance and convert the expand to grid-rows**

Replace the component's returned JSX (lines 43-93) with:
```tsx
  return (
    <div className="animate-tool-in rounded-xl border bg-card/50 text-xs">
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
            className={cn(
              "text-muted-foreground transition-transform duration-200 ease-[var(--ease-out)]",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {/* Expand/collapse via grid-rows 0fr↔1fr — animates to content height with
          no height:auto hack, on the compositor. Inner wrapper clips while
          collapsed. The virtualizer re-measures via its ResizeObserver. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out)]",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "space-y-2 border-t px-2.5 py-2 transition-opacity duration-200 ease-[var(--ease-out)]",
              open ? "opacity-100" : "opacity-0",
            )}
          >
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
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Visual verification**

Run the demo, open `http://localhost:5173/preview.html?screen=chat&state=tools`.
Confirm:
1. Tool pills settle in (fade + slight rise) when the transcript renders.
2. Clicking a pill smoothly expands/collapses its body (height grows/shrinks with the chevron rotating), no abrupt snap, content fades with the height.
3. The completed-tool check/error icon does a subtle pop. (A running tool shows the spinner; when it flips to ok/error in a live run the icon pops.)
4. Expanding a pill near the bottom while pinned doesn't break auto-scroll (re-measure follows the animation; minor reflow during the 200ms transition is acceptable).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/ToolCallCard.tsx
git commit -m "feat(extension): animate tool-call expand, entrance, and status pop"
```

---

## Task 5: ConversationsDrawer enter/exit with `motion`

The drawer currently mounts/unmounts instantly (`if (!open) return null`). Give it a slide-in panel + scrim fade with a proper **exit** animation via `AnimatePresence`. This is the textbook case for the `motion` library.

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/ConversationsDrawer.tsx`

- [ ] **Step 1: Replace the conditional return with `AnimatePresence`**

In `ConversationsDrawer.tsx`:

(a) Add imports at the top (after line 10, `import { IconButton } from "./primitives";`):
```tsx
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_DRAWER, EASE_OUT } from "@/lib/motion";
```

(b) Remove the early `if (!open) return null;` (line 31).

(c) Replace the returned JSX (lines 32-89) with an `AnimatePresence` that drives both enter and exit. The scrim cross-fades; the panel slides from the left edge using a hardware-accelerated `transform` string (per Emil's note that `motion`'s `x` shorthand isn't hardware-accelerated). Reduced motion collapses the slide to a fade:
```tsx
  const reduce = useReducedMotion();
  const panelHidden = reduce ? { opacity: 0 } : { opacity: 0, transform: "translateX(-100%)" };
  const panelShown = { opacity: 1, transform: "translateX(0%)" };

  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-40 flex">
          {/* Scrim */}
          <motion.button
            type="button"
            aria-label="Close conversations"
            onClick={onClose}
            className="absolute inset-0 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          />
          {/* Panel */}
          <motion.div
            className="relative flex h-full w-72 max-w-[85%] flex-col border-r bg-background shadow-xl"
            initial={panelHidden}
            animate={panelShown}
            exit={panelHidden}
            transition={{ duration: 0.3, ease: EASE_DRAWER }}
          >
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
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
```
Note: `EASE_OUT` is imported but only `EASE_DRAWER` + `EASE_OUT` are used (scrim uses `EASE_OUT`, panel uses `EASE_DRAWER`). Keep both imports.

- [ ] **Step 2: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Visual verification**

Run the demo, open `http://localhost:5173/preview.html?screen=chat&state=chat`, then click the header sidebar icon (top-left) to open the drawer. (Or open `screen=conversations` to see it open by default — but to see enter/exit, use the chat screen and toggle.)
Confirm: opening slides the panel in from the left with the scrim fading in (~300ms, iOS-like ease); clicking the scrim or close slides it back out (exit animation actually plays — it doesn't just disappear). Record a GIF (`gif_creator`) and review the open/close in slow motion: the slide should feel smooth with no flash of the panel at full position before animating.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/ConversationsDrawer.tsx
git commit -m "feat(extension): animate conversations drawer enter/exit with motion"
```

---

## Task 6: ToolApprovalCard enter/exit with `motion`

The approval card appears above the composer in `ask` mode and currently pops in with no transition and vanishes on decision. Give it an enter/exit via `AnimatePresence` (the presence wrapper lives where it's conditionally rendered: `App.tsx` and the demo `preview.tsx`).

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/ToolApprovalCard.tsx`
- Modify: `packages/extension/src/sidepanel/App.tsx`
- Modify: `packages/extension/src/demo/preview.tsx`

- [ ] **Step 1: Make the card a `motion.div`**

In `ToolApprovalCard.tsx`:

(a) Add imports after line 4 (`import { TOOL_ICON } from "./toolMeta";`):
```tsx
import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";
```

(b) Replace the outer wrapper `<div className={cn("mb-1.5 rounded-2xl border bg-card p-3 shadow-sm", className)}>` (line 32) with a `motion.div`, and add `reduce` inside the component before the `return`. The card enters fading up with a faint scale, and exits faster (Emil: exit faster than enter):
```tsx
export function ToolApprovalCard({ pending, onDecide, className }: ToolApprovalCardProps) {
  const action = VERB[pending.tool] ?? pending.tool;
  const icon: IconName = TOOL_ICON[pending.tool] ?? "ask";
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={cn("mb-1.5 rounded-2xl border bg-card p-3 shadow-sm", className)}
      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px) scale(0.98)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px) scale(0.98)" }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
```
Keep the rest of the card body unchanged, and change the matching closing `</div>` (line 77) to `</motion.div>`.

- [ ] **Step 2: Wrap the card in `AnimatePresence` in `App.tsx`**

In `App.tsx`:

(a) Add the import after line 20 (`import type { KnownProvider } from "@earendil-works/pi-ai";`):
```tsx
import { AnimatePresence } from "motion/react";
```

(b) Replace the `composerTop` prop value (lines 176-183) — wrap the conditional card in `AnimatePresence` and give it a stable `key`:
```tsx
        composerTop={
          <div className="mb-1.5 flex flex-col gap-1.5">
            <AnimatePresence>
              {perms.pending && (
                <ToolApprovalCard key="approval" pending={perms.pending} onDecide={perms.resolve} />
              )}
            </AnimatePresence>
            <div className="flex px-1">
              <PermissionModeToggle mode={perms.mode} onChange={perms.setMode} />
            </div>
          </div>
        }
```

- [ ] **Step 3: Wrap the demo card in `AnimatePresence` too**

In `preview.tsx`:

(a) Add the import after line 16 (`import { IndicatorShowcase } from "./IndicatorShowcase";`):
```tsx
import { AnimatePresence } from "motion/react";
```

(b) In `ChatScreen`, replace the `composerTop` content (lines 50-62) so the demo card also animates (and add a toggle so you can watch enter/exit). Replace the `<>...</>` with:
```tsx
      composerTop={
        <>
          <AnimatePresence>
            {state === "tools" && (
              <ToolApprovalCard
                key="approval"
                pending={{ id: "demo", tool: "navigate", origin: "dribbble.com" }}
                onDecide={() => {}}
              />
            )}
          </AnimatePresence>
          <div className="mb-1.5 flex px-1">
            <PermissionModeToggle mode={mode} onChange={setMode} />
          </div>
        </>
      }
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Visual verification**

Run the demo, open `http://localhost:5173/preview.html?screen=chat&state=tools` — the approval card should fade/rise in above the composer on load. (In the real extension, approving/denying makes it exit-animate out.) Record a GIF and confirm the entrance is ~200ms ease-out with the faint scale, no jump.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/ToolApprovalCard.tsx packages/extension/src/sidepanel/App.tsx packages/extension/src/demo/preview.tsx
git commit -m "feat(extension): animate tool-approval card enter/exit"
```

---

## Task 7: Send⇄Stop morph, empty-state stagger, copy pop (delight)

The three "light delight" moments.

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/ChatView.tsx` (send/stop morph at lines 122-134; empty-state stagger at lines 85-98)
- Modify: `packages/extension/src/sidepanel/components/chat/primitives.tsx` (MessageActions copy pop, lines 289-300)

- [ ] **Step 1: Send⇄Stop morph**

In `ChatView.tsx`, the streaming-conditional send/stop button (lines 123-134). Add a `key` so swapping triggers a small pop, and a `press`-style class is already provided by `IconButton`. Replace:
```tsx
            {streaming ? (
              <IconButton icon="stop" label="Stop" variant="brand" className="rounded-full" onClick={onStop} />
            ) : (
              <IconButton
                icon="send"
                label="Send"
                variant="brand"
                className="rounded-full"
                disabled={!canSend}
                onClick={submit}
              />
            )}
```
with:
```tsx
            {streaming ? (
              <IconButton
                key="stop"
                icon="stop"
                label="Stop"
                variant="brand"
                className="animate-pop rounded-full"
                onClick={onStop}
              />
            ) : (
              <IconButton
                key="send"
                icon="send"
                label="Send"
                variant="brand"
                className="animate-pop rounded-full"
                disabled={!canSend}
                onClick={submit}
              />
            )}
```
The `key` change between `send`/`stop` remounts the button, replaying the `animate-pop` (scale 0.8→1) so the icon swap reads as a quick morph.

- [ ] **Step 2: Empty-state stagger**

In `ChatView.tsx`, the empty state (lines 85-98). Add the `animate-fade-up` utility with increasing `animationDelay` to the brand icon, heading, and suggestions grid so they cascade in. Replace the empty-state block:
```tsx
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4">
          <div
            className="animate-fade-up flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"
            style={{ animationDelay: "0ms" }}
          >
            <Icon name="brand" size={26} />
          </div>
          <h1 className="animate-fade-up text-center text-xl font-semibold tracking-tight" style={{ animationDelay: "60ms" }}>
            What can I help with?
          </h1>
          {suggestions && suggestions.length > 0 && (
            <div
              className="animate-fade-up grid w-full max-w-sm grid-cols-2 gap-2"
              style={{ animationDelay: "120ms" }}
            >
              {suggestions.slice(0, 4).map((s) => (
                <SuggestionChip key={s} text={s} onClick={() => onSend(s)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <MessageList messages={messages} streaming={streaming} />
      )}
```

- [ ] **Step 3: Copy → Copied pop**

In `primitives.tsx`, `MessageActions` (lines 289-300). Add a `key` on the IconButton so the copy→check swap pops. Replace the returned JSX:
```tsx
  return (
    <div className="mt-1 flex items-center gap-0.5">
      <IconButton
        key={copied ? "check" : "copy"}
        icon={copied ? "check" : "copy"}
        label={copied ? "Copied" : "Copy"}
        size="sm"
        onClick={copy}
        className={cn("animate-pop", copied && "text-success hover:text-success")}
      />
    </div>
  );
```
Add `cn` to the imports if not present — `primitives.tsx` already imports `cn` from `@/lib/utils` (line 10), so no new import is needed.

- [ ] **Step 4: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Visual verification**

Run the demo:
1. `screen=chat&state=empty` — the brand icon, heading, then suggestion chips cascade in (~50-60ms apart). Reload to replay.
2. `screen=chat&state=chat` — hover an assistant message, click copy: the icon swaps copy→check with a small pop and "Copied" tooltip; reverts after ~1.2s.
3. Send/stop: in a live run the send button pops to the stop square and back. In the demo, `useDemoChat` toggles `streaming` — trigger a send to watch the morph.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/ChatView.tsx packages/extension/src/sidepanel/components/chat/primitives.tsx
git commit -m "feat(extension): send/stop morph, empty-state stagger, copy pop"
```

---

## Task 8: Popover & tooltip easing retune (CSS, minor)

Align the existing base-ui popup transitions to Emil's stronger `--ease-out` curve, and give tooltips a subtle origin-aware scale/opacity transition with a provider delay (instant on subsequent hovers is handled by base-ui's tooltip group delay).

**Files:**
- Modify: `packages/extension/src/sidepanel/components/chat/primitives.tsx` (Combobox popup, line 217)
- Modify: `packages/extension/src/sidepanel/components/ui/select.tsx` (Popup className, line 140)
- Modify: `packages/extension/src/sidepanel/components/ui/tooltip.tsx`

- [ ] **Step 1: Retune the Combobox popup easing**

In `primitives.tsx` line 217, the `Combobox.Popup` className contains `transition-[transform,opacity] duration-150`. Add the easing token. Change that fragment from:
```
transition-[transform,opacity] duration-150 data-[ending-style]:scale-95
```
to:
```
transition-[transform,opacity] duration-150 ease-[var(--ease-out)] data-[ending-style]:scale-95
```

- [ ] **Step 2: Add a popup transition to the Select**

In `select.tsx` line 140, the `SelectPrimitive.Popup` className is:
```tsx
          className="origin-(--transform-origin) text-foreground outline-none"
```
Change to add an origin-aware scale/opacity transition consistent with the Combobox:
```tsx
          className="origin-(--transform-origin) text-foreground outline-none transition-[transform,opacity] duration-150 ease-[var(--ease-out)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0"
```

- [ ] **Step 3: Add tooltip delay + transition**

In `tooltip.tsx`:

(a) Set a sensible group delay on the provider export (line 7). Replace:
```tsx
export const TooltipProvider = TooltipPrimitive.Provider;
```
with:
```tsx
// 400ms first-hover delay prevents accidental activation; base-ui keeps the
// group "warm" so adjacent tooltips open instantly while one is already open.
export function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={400} closeDelay={0} {...props} />;
}
```

(b) Add a subtle scale/opacity transition to the tooltip popup (lines 30-37). Replace the `cn(...)` first argument:
```tsx
              "select-none rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md",
```
with:
```tsx
              "origin-(--transform-origin) select-none rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md transition-[transform,opacity] duration-[125ms] ease-[var(--ease-out)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS. (If `TooltipPrimitive.Provider.Props` is not a valid type path, fall back to `import type { ComponentProps } from "react"` and type the wrapper as `ComponentProps<typeof TooltipPrimitive.Provider>`.)

- [ ] **Step 5: Visual verification**

Run the demo, `screen=chat&state=chat`:
1. Open the model picker (Combobox) and the provider picker (Select) — both should scale/fade in from their trigger with the stronger ease.
2. Hover a header icon button — the tooltip appears after ~400ms with a subtle scale; hovering the next icon while one is open shows it instantly.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/sidepanel/components/chat/primitives.tsx packages/extension/src/sidepanel/components/ui/select.tsx packages/extension/src/sidepanel/components/ui/tooltip.tsx
git commit -m "feat(extension): retune popover/tooltip easing to Emil curves"
```

---

## Task 9: Indicator ripple polish (DOM/CSS)

The in-page indicator is already well-tuned. One Emil-aligned tweak: the click ripple currently starts at `scale(.3)` — nudge it up so it doesn't appear from near-nothing. Pure DOM/CSS, no library.

**Files:**
- Modify: `packages/extension/src/control/indicator/dom.ts:61`
- Test: `packages/extension/test/indicatorDom.test.ts`

- [ ] **Step 1: Find the existing ripple keyframe assertion (if any) and add a precise one**

In `indicatorDom.test.ts`, locate the ripple-related test (search for `obc-ripple` or `addRipple`). Add (or extend) a test asserting the keyframe starts from `scale(.5)` rather than `scale(.3)`. Add this test inside the existing top-level `describe` structure (alongside the other DOM tests):
```ts
test("ripple keyframe starts from a visible scale, not from near-zero", () => {
  showGlow(); // ensures styles are injected
  const styles = doc().getElementById("obc-indicator-styles")!.textContent!;
  expect(styles).toContain("obc-ripple");
  expect(styles).toContain("scale(.5)");
  expect(styles).not.toContain("scale(.3)");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/extension && bun test test/indicatorDom.test.ts`
Expected: FAIL — current keyframe contains `scale(.3)`.

- [ ] **Step 3: Update the ripple keyframe**

In `dom.ts` line 61, change the ripple keyframe `from` scale:
```ts
    `@keyframes obc-ripple { from { transform: translate(-50%,-50%) scale(.3); opacity: .8; } to { transform: translate(-50%,-50%) scale(1.6); opacity: 0; } }\n` +
```
to:
```ts
    `@keyframes obc-ripple { from { transform: translate(-50%,-50%) scale(.5); opacity: .8; } to { transform: translate(-50%,-50%) scale(1.6); opacity: 0; } }\n` +
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/extension && bun test test/indicatorDom.test.ts`
Expected: PASS.

- [ ] **Step 5: Visual verification**

Run the demo, open `http://localhost:5173/preview.html?screen=indicator`. Confirm the cursor glide, glow pulse, spotlight, and click ripple still behave — the ripple now begins as a visible ring rather than a dot. Watch for any performance regression (the IndicatorShowcase has a frame-time guard; it should not trip).

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/control/indicator/dom.ts packages/extension/test/indicatorDom.test.ts
git commit -m "feat(extension): start indicator ripple from a visible scale"
```

---

## Task 10: Demo "Motion" review pass + final verification

Add nothing new functionally — verify the whole motion layer cohesively (Emil's "review your work" + slow-motion), run the full suite and typecheck, and confirm reduced-motion behavior.

**Files:**
- (No source changes required unless the review surfaces a fix.)

- [ ] **Step 1: Run the full test suite**

Run: `cd packages/extension && bun test`
Expected: PASS — all existing tests plus `motion.test.ts`, `seen.test.ts`, and the updated `indicatorDom.test.ts`. If any pre-existing test broke (e.g. a snapshot of `ConversationsDrawer`/`ToolApprovalCard` markup), inspect and fix.

- [ ] **Step 2: Typecheck the whole package**

Run: `cd packages/extension && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Cohesion + slow-motion review (Emil)**

Run the demo (`bun run dev`). For each screen below, record a GIF with `gif_creator` and review at reduced speed (or use Chrome DevTools Animations panel):
- `screen=chat&state=empty` — stagger cascade.
- `screen=chat&state=chat` — message send fade-up, copy pop, picker open.
- `screen=chat&state=tools` — tool pill entrance, expand/collapse, status pop, approval-card entrance.
- `screen=chat` + toggle the drawer — drawer slide enter/exit.
- `screen=indicator` — glow/cursor/spotlight/ripple.

Check for: any animation over ~300ms feeling sluggish; any `ease-in`/center-origin mistakes; transforms in sync with opacity; no layout jank during streaming. Tune durations/easing inline if anything feels off (durations live in the component `transition` props and the `@utility` blocks in `index.css`).

- [ ] **Step 4: Reduced-motion check**

In the demo (or Chrome DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce"), reload and confirm: animations are effectively instant (no slides/scales/fades of consequence), the drawer and approval card still appear/disappear correctly, and nothing is broken or stuck hidden.

- [ ] **Step 5: Build sanity check**

Run: `cd packages/extension && bun run build`
Expected: the extension build completes without errors (confirms the `motion` import and new CSS compile in the real bundle, not just the demo).

- [ ] **Step 6: Final commit (if any tuning was applied)**

```bash
git add -A
git commit -m "chore(extension): motion review pass — tuning + reduced-motion verification"
```

---

## Self-Review Notes

- **Spec coverage** — every surface from the approved design maps to a task: tokens/reduced-motion (T1), press feedback (T2), message entrance (T3), tool calls expand/entrance/status (T4), drawer (T5), approval card (T6), send⇄stop + stagger + copy (T7), pickers/tooltips (T8), indicator (T9), review + reduced-motion + build (T10).
- **Library strategy honored** — `motion` used only in T5/T6 (unmount-exit); everything else is CSS; indicator stays DOM/CSS.
- **Virtualizer constraint honored** — T3 animates an inner wrapper only (opacity + tiny translate), never row height or the positioning transform.
- **Type consistency** — `SeenSet` API (`isNew`, `remember`) and `lib/motion.ts` exports (`EASE_OUT`, `EASE_IN_OUT`, `EASE_DRAWER`, `SPRING`, `prefersReducedMotion`) are used exactly as defined.
- **Known risk to watch in T4** — the grid-rows expand triggers virtualizer re-measure via ResizeObserver mid-transition; verified visually in T4 step 4. If reflow is distracting, fall back to keeping the expand instant (drop the `transition-[grid-template-rows]`) while keeping the content fade.
