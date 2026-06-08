# Chat: markdown rendering + virtualized message list

**Date:** 2026-06-08
**Status:** Approved design, pending implementation plan

## Problem

The side-panel chat (`ChatView.tsx`) renders assistant replies as plain text
(`m.text` dropped into JSX with `whitespace-pre-wrap`) and lays every message
out in a single un-virtualized column inside a base-ui `ScrollArea`. Two gaps:

1. **No markdown** — model output (headings, lists, code blocks, tables, inline
   code, bold) shows as raw text.
2. **No virtualization** — all messages render at once. With markdown each
   message is more expensive to render (parse + Shiki highlight), so a long
   conversation re-parses every off-screen message on each token during
   streaming.

## Goal

- Render **assistant** messages as markdown with syntax-highlighted code.
- **Virtualize** the message list so only on-screen messages render.
- Preserve the current look (narrow-panel-friendly, `max-w-2xl` column, base-ui
  thin scrollbar) and streaming behavior (token-by-token growth, stick to
  bottom).

## Non-goals

- No change to the message data model (`UiMessage = {id, role, text,
  streaming}`) or to how `useSessions` / `useDemoChat` produce props.
- No mermaid diagrams, no math/KaTeX (Streamdown plugins we deliberately do not
  import — keeps them out of the bundle).
- No markdown for **user** messages (decided — see below).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Markdown library | **Streamdown** (`streamdown` + `@streamdown/code`) | Built for streaming AI output: completes half-streamed fences/bold, opt-in plugin architecture keeps mermaid/math out of the bundle. |
| Code highlighting | **Shiki** via `@streamdown/code` | User choice; accurate, themeable to `github-light`/`github-dark`. |
| Virtualization | **`@tanstack/react-virtual`** with dynamic `measureElement` | Variable message heights; standard chat pattern. |
| Scroll host | **Keep base-ui `ScrollArea`**; forward its Viewport node to the virtualizer | Preserves the existing thin scrollbar. |
| User messages | **Plain text** (unchanged bubble) | Avoid reinterpreting the user's literal `#`/`*`/`_` as formatting. |
| Jump-to-bottom | **Floating pill button** when scrolled away from latest | Standard chat affordance. |
| Shiki engine / CSP | Add `wasm-unsafe-eval` to manifest CSP **iff** the build shows Shiki needs WASM | Confirmed empirically at build/load; narrow permission (WASM compile only). |

## Architecture

All changes are confined to the view layer. Data flow is unchanged:
`useSessions` / `useDemoChat` → `ChatViewProps` → `ChatView` → `MessageList`.

### New / changed files

1. **`components/chat/Markdown.tsx`** (new) — thin wrapper over Streamdown,
   the single place markdown is configured:
   ```tsx
   <Streamdown
     plugins={{ code }}
     isAnimating={streaming}
     parseIncompleteMarkdown
     shikiTheme={["github-light", "github-dark"]}
     controls
     components={/* map elements to existing Tailwind tokens */}
     className="..."
   >
     {text}
   </Streamdown>
   ```
   - Styled with existing tokens: `foreground`, `muted-foreground`, `border`,
     `secondary` for inline/code background. Prose spacing tuned for the narrow
     panel.
   - **Tables** wrapped so they get `overflow-x-auto` (can't widen the panel).
   - `controls` → copy button on code blocks.
   - Relies on Streamdown's `isAnimating` for the in-flight treatment, so the
     **manual blinking-cursor span (`ChatView.tsx:119-121`) is removed**.
   - `parseIncompleteMarkdown` (default on) hardens partial markdown mid-stream.

2. **`components/chat/MessageList.tsx`** (new) — the virtualized list,
   replacing the `messages.map(...)` + `bottomRef` block in `ChatView`.
   - `useVirtualizer({ count, getScrollElement: () => viewportRef.current,
     estimateSize: () => ~80, overscan: 6 })` with per-row
     `ref={virtualizer.measureElement}` + `data-index` for dynamic heights.
   - Virtual items absolutely positioned (`translateY`) inside a
     `position: relative; height: totalSize` spacer, inside the existing
     `max-w-2xl mx-auto px-3` column.
   - Inter-message spacing moves from flex `gap-4` to **per-row padding**
     (flex gap does not survive absolute positioning).
   - Renders **user** rows as the current plain-text bubble and **assistant**
     rows via `<Markdown>`.
   - Owns the floating **jump-to-bottom** button (shown when not near bottom).

3. **`components/ui/scroll-area.tsx`** — add an optional `viewportRef` prop
   forwarded to `ScrollAreaPrimitive.Viewport`, so `MessageList` can hand the
   scroll element to the virtualizer while keeping the styled scrollbar.

4. **`lib/autoscroll.ts`** (new, pure) — the stick-to-bottom logic, unit-tested:
   - `isNearBottom(scrollTop, clientHeight, scrollHeight, threshold = 64):
     boolean`
   - The decision helper the `MessageList` effect consumes. Kept pure so it is
     testable under `bun:test` (this repo tests logic/DOM, not React render).

5. **`components/chat/ChatView.tsx`** — replace the inline message rendering and
   the `scrollIntoView` effect with `<MessageList messages={messages}
   streaming={streaming} />`.

6. **`sidepanel/index.css`** — add the Streamdown Tailwind v4 source so its
   classes are generated, plus its animation styles:
   ```css
   @source "<relative path>/node_modules/streamdown/dist/*.js";
   /* and */ @import "streamdown/styles.css";
   ```
   (Exact relative path resolved against where Bun installs streamdown — verify
   at implementation; Bun hoists to the workspace-root `node_modules`.)

7. **`manifest.json`** — if the build/load shows Shiki requires WASM, add:
   ```json
   "content_security_policy": {
     "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
   }
   ```
   Omit if `@streamdown/code` runs the JS RegExp engine. Resolved empirically.

8. **Demo** (`src/demo/mock.ts`, and a demo state if needed) — enrich canned
   replies with real markdown (headings, lists, fenced code in a few languages,
   a table, inline code, bold/links) and add a **long-conversation seed** so the
   `bun dev` playground actually exercises virtualization + streaming.

## Stick-to-bottom behavior

- Track `shouldStick`, recomputed on scroll via `isNearBottom(...)`
  (~64px threshold).
- On a **new turn** (`messages.length` increases) or **streaming growth** (last
  row resizes) → if `shouldStick`, `virtualizer.scrollToIndex(count - 1,
  { align: "end" })`.
- **Initial mount / opening a stored conversation** → jump to bottom (align
  end, no smooth animation).
- If the user scrolls up mid-stream, `shouldStick` goes false and we stop
  forcing them down; the **jump-to-bottom pill** appears and, on click,
  re-pins (`shouldStick = true` + scroll to last).

## Streaming + markdown interplay

- Streamdown `parseIncompleteMarkdown` completes unterminated fences/emphasis so
  partial tokens render cleanly.
- `isAnimating={m.streaming}` drives the in-flight animation (replaces the
  manual cursor).
- The last row grows as tokens arrive → `measureElement`'s ResizeObserver
  re-measures → total size updates → the re-pin effect keeps it at the bottom
  while `shouldStick`.

## Testing

- **TDD** `lib/autoscroll.ts` under `bun:test`: `isNearBottom` boundaries (at
  bottom, just inside threshold, scrolled up, zero-height/empty list).
- **Live verification** in the `bun dev` playground for virtualization +
  Streamdown rendering + streaming + jump-to-bottom. happy-dom returns 0
  element heights, so component-level virtualization tests would be meaningless;
  the playground (with the long-conversation seed) is the verification surface.
- `bun run typecheck` green; existing tests stay green.
- Confirm at extension load: no CSP violation in the side-panel console (decides
  the `wasm-unsafe-eval` line).

## Risks

- **WASM/CSP** — resolved at build/load (above).
- **base-ui Viewport + virtualizer** — a tall spacer is just tall content to
  base-ui's overflow detection; verify the scrollbar and overflow data-attrs
  still behave with absolutely-positioned children.
- **Bundle size** — Shiki grammars/themes add weight (accepted tradeoff); can
  restrict languages via the `code` plugin later if needed.
