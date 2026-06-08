# Tool calls in the chat transcript

**Date:** 2026-06-08
**Status:** Approved design, pending implementation plan

## Problem

The agent calls browser tools (navigate, read_page, click, type, scroll,
screenshot, wait_for) during a turn, but the UI shows nothing in the transcript
— only a transient "Running X…" line above the composer. `ChatSession.getMessages()`
flattens the agent state to text-only (`{role, text}`), dropping the `ToolCall`
blocks and `ToolResultMessage`s entirely, and persistence stores only user/
assistant text. So the user can't see what the agent did, and reopened
conversations have no tool history.

## Goal

- Render each tool call inline in the transcript as a **collapsed, expandable
  pill** (per-tool icon + human label + one-line args summary + status), which
  expands to show raw args and the result.
- **Persist** tool calls so reopened conversations show them.
- **Thumbnail** screenshot results (image content) in the expanded view.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Detail level | Collapsed pill, expandable to args + result |
| Persistence | Persist tool calls (display history), not just live |
| Big results | Truncate/scroll text; render screenshots as inline thumbnails |
| Icons | Per-tool glyphs (8 hugeicons) |

## Non-goals

- Replaying tool results back to the LLM on continuation. The agent's LLM
  history stays **text-only** (cheap, unchanged) — persistence is for *display*.
- Rendering `thinking` blocks (thinkingLevel is "off").
- Tool re-run / retry affordances.

## Architecture

### 1. Transcript item model — `lib/transcript.ts` (new, pure, TDD'd)

```ts
export type ToolStatus = "running" | "ok" | "error";

export interface ToolResultView {
  text?: string;
  image?: { data: string; mimeType: string };
}

export type TranscriptItem =
  | { kind: "text"; id: string; role: "user" | "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>;
      status: ToolStatus; result?: ToolResultView; error?: string };

export function buildTranscript(
  messages: AgentMessage[],
  streaming?: AgentMessage,
): TranscriptItem[];
```

`buildTranscript` walks the pi messages in order:
- `user` → text item.
- `assistant` → for each content block in source order: non-empty `text` →
  text item; `toolCall` (`{id, name, arguments}`) → tool item.
- `toolResult` (`{toolCallId, content, isError}`) → not a standalone item;
  indexed by `toolCallId` and merged into the matching tool item: `status` =
  `error` if `isError` else `ok`; `result.text` = joined text content;
  `result.image` = first image content. A tool item with no matching result is
  `running`.
- `streaming` (the in-flight assistant) is processed the same way and appended,
  so partial text/tool calls show live.

Item `id`: within `buildTranscript`, text items use `t${index}` and tool items
use the `toolCallId` (stable across running → done). Seeded items (from storage)
carry their stored row id (a UUID). These namespaces don't collide, so React
keys stay unique across the `seededTranscript ++ live` concatenation.

### 2. ChatSession — `lib/chat.ts`

- New `getTranscript(): TranscriptItem[]` =
  `seededTranscript` ++ `buildTranscript(agent.state.messages.slice(seedCount),
  agent.state.streamingMessage)`. The agent is seeded with text-only history, so
  `seedCount = (initialMessages ?? []).length` and the seeded text is never
  double-counted against the rich `seededTranscript`.
- `ChatSessionOptions` gains `initialTranscript?: TranscriptItem[]` (the rich
  display seed, from storage). Stored on the instance as `seededTranscript`.
- `getMessages()` is unchanged (still the text view used for the LLM seed,
  `setModel`, and the persistence text path).

### 3. Persistence — `lib/sessions/types.ts`, `SessionManager.ts`

`StoredMessage` gains optional fields (backward-compatible; the `messages`
IndexedDB store is schemaless per-record, so **no migration** — rows without
`kind` are treated as text):

```ts
interface StoredMessage {
  id; conversationId; seq; createdAt;
  role: "user" | "assistant";      // tool rows use "assistant"
  kind?: "text" | "tool";          // absent ⇒ "text"
  text?: string;                   // text rows (tool rows omit)
  // tool rows:
  toolName?: string;
  argsJson?: string;
  status?: "ok" | "error";
  resultText?: string;
  resultImageData?: string;
  resultImageMime?: string;
}
```

- `send()`: persist the user row immediately (as today, for title + resilience),
  then after the turn persist **every new transcript item** (`getTranscript()`
  beyond the pre-turn boundary, minus the leading user item) in order — text
  rows and tool rows. This also fixes intermediate assistant text being dropped
  today. Persisted tool rows carry the finalized status (`ok`/`error`), never
  `running`.
- `open()`: load rows sorted by `seq`; build **two** seeds — `ChatMessageView[]`
  (text rows only → agent seed) and `TranscriptItem[]` (all rows → display
  seed). Pass both into `createSession`.
- `setModel()`: pass the current cleaned `getTranscript()` as `initialTranscript`
  so display tool history survives a model swap (alongside the existing text
  re-seed).

### 4. UI

- **`types.ts`**: `UiItem = UiTextMessage | UiToolCall` (discriminated by
  `kind`). `ChatViewProps.messages: UiItem[]`. Empty-state check
  (`messages.length === 0`) is unchanged.
- **`useSessions.ts`**: `toUiItems(transcript, streaming)` replaces
  `toUiMessages`, mapping `TranscriptItem[]` → `UiItem[]` (streaming flag on the
  last text item).
- **`icons.tsx`**: add 8 per-tool glyphs — navigate `Globe02Icon`, read_page
  `Layout01Icon`, get_page_text `TextFontIcon`, click `Cursor02Icon`, type
  `KeyboardIcon`, scroll `MouseScroll01Icon`, screenshot `Camera01Icon`,
  wait_for `HourglassIcon`.
- **`ToolCallCard.tsx`** (new): collapsed pill — tool icon, human label
  (resolved from a `name → {label, icon}` map), `summarizeArgs(name, args)`
  one-liner (pure, tested: e.g. `Navigate → example.com`, `Click → e3`,
  `Type → e5`, `Scroll ↓`), and a status indicator (running → `Spinner`; ok →
  `check` in success color; error → `close` in destructive color). A chevron
  toggles expansion (local `useState`) revealing raw args (JSON, monospace) and
  the result: truncated/scrollable text, and a **screenshot thumbnail**
  (`<img src="data:{mime};base64,{data}">`, capped height, click-to-open
  optional/skipped for v1). Error rows show `error` text in destructive color.
- **`MessageList.tsx`**: switch on `item.kind` — `text` → existing user bubble
  or `Markdown`; `tool` → `ToolCallCard`. Tool rows are full-width (no bubble).
  The virtualizer's dynamic `measureElement` already re-measures when a card
  expands (same mechanism streaming growth uses).
- **`App.tsx`**: remove the transient "Running {activeTool}…" line in
  `composerTop` (the inline running pill replaces it). The page-glow path
  (`onAgentActive`/`setActiveTabIndicator`) is untouched. `activeTool` may be
  dropped from `UseSessions` if no longer consumed.

### 5. Demo — `demo/mock.ts`, `demo/useDemoChat.ts`, `demo/preview.tsx`, `demo/Demo.tsx`

Add a sample conversation (a new "Tools" state) with tool items exercising:
running, ok (with args + text result), error (with error text), and a
screenshot result (small inline data-URI thumbnail). The demo's `UiItem[]` path
mirrors the real app.

## Testing

- **TDD** `buildTranscript`: text/tool interleaving, result matching by
  `toolCallId`, `running` (no result) / `ok` / `error` status, image extraction,
  streaming message handling.
- **TDD** `summarizeArgs`: one per tool shape (navigate url vs direction, click
  ref, type ref, scroll direction, no-arg tools).
- Extend **`sessionManager.test.ts`**: a fake session whose `getTranscript()`
  returns text + tool items → assert tool rows persist with finalized status and
  that `open()` reconstructs the rich transcript (and that the agent seed stays
  text-only).
- Update **`toUiMessages.test.ts`** → `toUiItems` mapping.
- **Live verification** in the `bun dev` playground (pills, expand/collapse,
  screenshot thumbnail, dark theme, virtualization re-measure on expand).
- `bun run typecheck` + `bun test` + `bun run build` green.

## Risks / notes

- **Storage growth**: base64 screenshots in IndexedDB add up. `unlimitedStorage`
  is granted, so it works; a size cap or downscale is a possible follow-up.
- **base-ui Viewport + expanding cards**: re-measure on expand uses the same
  ResizeObserver path streaming already relies on — verified in the playground.
- **Message-model churn**: `messages: UiMessage[]` → `UiItem[]` touches
  `types.ts`, `ChatView`, `MessageList`, `useSessions`, and the demo; contained
  to the view layer, no agent/tool changes.
