# Chat UI design

Working notes + assets for the side-panel chat UI rebuild.

## References

User-provided inspiration (`references/chat-ui/`):

- `01-composer-states.png` — floating, rounded composer cards with an indigo accent; rich input states (model chip, quick actions, drop zone, voice).
- `02-dark-rich-chat.png` — dark, dense, feature-heavy chat (reply/quote, command palette, context cards).
- `03-minimal-mobile.png` — minimal ChatGPT/Claude-app feel: plain assistant text, gray user bubbles, footer disclaimer.

## Playground

A standalone dev harness to iterate on the UI **without loading the extension** and
without provider credentials (uses mock data):

```bash
cd packages/extension
bun dev            # http://localhost:5173
```

- `index.html` → control panel (`src/demo/Demo.tsx`): pick state / theme / width.
- `preview.html` → one layout full-bleed (`src/demo/preview.tsx`), embedded in a
  width-constrained **iframe** so Tailwind breakpoints match the real Chrome side
  panel (the iframe's width is its viewport width; a normal window can't go below
  ~500px on macOS).
- Width slider goes down to 280px to stress-test narrow widths and overflow.

Icons: **hugeicons** (`@hugeicons/react` + `@hugeicons/core-free-icons`), centralized in
`src/sidepanel/components/chat/icons.tsx`.

## Chat surface

`ChatView.tsx` is a pure view over `ChatViewProps`
(`src/sidepanel/components/chat/types.ts`) and uses `primitives.tsx` (IconButton, Picker,
SuggestionChip, MessageActions).

Chosen direction: **Minimal chat UI with a rounder feel.** Monochrome; assistant replies
render as plain full-width text (no avatars), user turns in a subtle bubble; pill composer
with circular icon/send buttons; footer disclaimer. Based on `03-minimal-mobile.png`, with
the softer radii from `01-composer-states.png`.

Wired into the real app via `App.tsx` + `useSessionView.ts` (adapts a `ChatSession` into
`ChatViewProps`). Two earlier candidates (a bubble-heavy "Floating" variant) were dropped.

Sample renders at side-panel width live in `renders/`.
