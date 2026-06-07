# 09 — Workflow Recording & Replay Subsystem ("Teach Claude")

## a. Summary

The "Teach Claude" / "record-a-demo" feature lets a user demonstrate a browser task by clicking through it while Claude watches. It captures **clicks, keystrokes, navigations, tab creation, and optionally spoken narration** via Web Speech API. When the user clicks "Done", a Claude call (`generateWorkflowSummary`) synthesises the raw event stream into a reusable natural-language prompt with extracted dynamic inputs. That prompt is stored as a **shortcut** (`savedPrompts` in `chrome.storage.local`). On replay the shortcut prompt is injected as a user message into a fresh Claude session, and Claude re-derives the browser actions through the normal tool-calling path — there is **no deterministic event replay**.

The file `startRecording-DT2Ni7PN.js` and `useStorageState-C6Ou-D0H.js` are a **Datadog RUM / Session Replay SDK** (strings: `Datadog`, `sessionReplayEndpointBuilder`, `USE_CHANGE_RECORDS`). They record DOM mutations for Anthropic's own product analytics and are **unrelated** to the "Teach Claude" recording subsystem.

---

## b. Capture Pipeline

All "Teach Claude" capture code lives in `sidepanel-BL0NRfq2.js`, inside the React hook `K5` and the helper class `W5` (`ElementSelector`). There is **no rrweb** and no DOM snapshot for workflow recording.

### 1. Element Selector Injection (`W5.injectElementSelector`)

When recording starts, `chrome.scripting.executeScript` injects an anonymous content-script into the target tab that:

- Attaches a **capture-phase click listener** (`document.addEventListener("click", c, true)`).
- Attaches **capture-phase keydown and focus listeners** to track characters typed into `INPUT`/`TEXTAREA`/`[contenteditable]` elements.
- On each click: collects a CSS selector (priority: `#id`, `.class`, `[data-*]`, `[aria-label]`, `:contains(text)`), tag name, visible text (truncated 100 chars), element bounding rect, and a set of attributes (`id`, `class`, `name`, `type`, `href`, `aria-label`, `aria-description`, `role`, `title`, `data-tooltip`, `data-tip`, `data-testid`, `placeholder`, `alt`, `value`). Sends `ELEMENT_SELECTION` message.
- On keystrokes: accumulates chars into a buffer, sends `KEYSTROKE_UPDATE` on each key with the running text and element descriptor.

### 2. Screenshot Capture

Immediately after each `ELEMENT_SELECTION` message is received by the sidepanel, `captureFullScreen` fires (`chrome.tabs.captureVisibleTab` under the hood). The screenshot is then annotated by drawing a **blue circle** over the click coordinates via a Canvas 2D draw call. Screenshots are stored as base64 JPEG in each step object.

### 3. Navigation / Tab Events

- `chrome.tabs.onActivated` → records `create_tab` + `navigate` steps when a new tab enters the recording tab-group.
- `chrome.webNavigation` / tab status polling → records `navigate` steps on `status === "complete"`.

### 4. Voice Narration (Web Speech API)

A separate React hook manages `window.SpeechRecognition` / `window.webkitSpeechRecognition`:

```js
const e = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
e.continuous = true;
e.interimResults = true;
e.lang = "en-US";
```

Speech segments are collected as `{ text, timestamp, isFinal }`. Each step can have a `speechTranscript` field populated with the spoken words recorded in the window immediately before that click.

### 5. AI-Enhanced Step Descriptions (per-step, real-time)

After each click step is captured, `generateWorkflowStepDescription` (`p5`) sends the element metadata + annotated screenshot to Claude (`claude-sonnet-4-5-20250929`, `maxTokens: 64`, `modelClass: "small_fast"`) to produce a short human-readable description like "Click on three-dot menu". This is optional polish — it runs asynchronously while recording continues.

---

## c. Recorded Artifact Schema

Steps are accumulated in React state (`recordingState.steps: Step[]`). No step data is written to `chrome.storage` during recording — it is ephemeral until "Done" is pressed.

```ts
interface RecordingStep {
  action: "click" | "type" | "navigate" | "create_tab" | "narration";

  // All steps
  description: string;       // Human-readable label (AI-generated for click/type)
  url: string;               // Current page URL at time of step
  tabId: number;
  timestamp: number;         // Date.now() ms

  // click steps
  selector?: string;         // CSS selector, e.g. "#submit-btn" or "button.primary"
  elementText?: string;
  elementAttributes?: Record<string, string>;
  screenshot?: string;       // base64 JPEG (no data: prefix)
  clickPosition?: { x: number; y: number };
  viewportDimensions?: { width: number; height: number };
  isEnhancing?: boolean;     // true while AI description is generating

  // type steps
  value?: string;            // text typed
  isPending?: boolean;       // true while still typing

  // speech annotation (any step)
  speechTranscript?: string; // words spoken in the window just before this step
}

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  steps: RecordingStep[];
  startTime: number | null;
}
```

Screenshots are stripped from steps before persistence (see §d).

---

## d. Storage

### Storage key

`chrome.storage.local` key: `"savedPrompts"` (enum value `W.SAVED_PROMPTS`).

### Shortcut / Prompt object

```ts
interface SavedPrompt {
  id: string;           // "prompt_<Date.now()>"
  command: string;      // slash-command name, e.g. "fill-form"
  prompt: string;       // the synthesised reusable prompt text (no screenshots)

  // optional scheduling
  repeatType?: "none" | "once" | "daily" | "weekly" | "monthly" | "annually";
  specificTime?: string;    // "HH:MM"
  specificDate?: string;    // "YYYY-MM-DD"  (once)
  dayOfWeek?: number;       // 0-6 (weekly)
  dayOfMonth?: number;      // 1-31 (monthly)
  monthAndDay?: string;     // "M-D" (annually)
  model?: string;           // optional model override

  url?: string;             // optional target URL
  createdAt: number;
  usageCount: number;
  lastUsedAt?: number;
  nextRun?: number;         // scheduled alarm time (populated by updateNextRunTimes)
}
```

**Key note**: Screenshots are **not** stored. The `generateWorkflowSummary` call receives all steps including screenshots; if `saveWithoutScreenshots === true` (the normal path via the "Done" button in `F3`), it generates extra-verbose textual descriptions of each screenshot, and the final prompt text describes everything verbally. The steps array passed to `savePrompt` has screenshots stripped to `undefined` before storage.

**Size**: No chunking was observed. The prompt is plain text, typically < 2 KB.

---

## e. Demo → Automation Synthesis

This is the central intelligence step. When the user taps "Done" (`j` callback in `F3`):

1. `generateWorkflowSummary(steps, createAnthropicMessage, saveWithoutScreenshots=true)` is called.
2. It builds a prompt that lists numbered steps with descriptions, concatenates all speech transcripts, and includes any screenshots as base64 images in the message.
3. System prompt instructs Claude to:
   - Treat **spoken narration as the primary source of truth** for intent.
   - Identify **dynamic inputs** (specific values like prices, names, dates) and extract them as `<inputs>` placeholders.
   - Output: `<inputs>` block + `<prompt>` block.
4. Model: `claude-sonnet-4-5-20250929`, `maxTokens: 512`.
5. The parsed `inputs` are prepended as elicitation questions: "Before running this workflow, please provide: ...".
6. The final string becomes `SavedPrompt.prompt`.

Shortcut naming (`generateShortcutName` / `d5`) is a separate small-model call (`modelClass: "small_fast"`) that generates a slug from the prompt text.

### Shortcut token format

When a shortcut is referenced in the UI (e.g. from a message or via `/command` typing), it is encoded as:

```
[[shortcut:<id>:<command>]]
```

Before sending to the API, `Ks()` resolves all such tokens by substituting `savedPrompt.prompt` for the token. This is a late-binding expansion — the stored text is inserted verbatim as the user's message.

---

## f. Replay / Execution Model

**Replay is entirely model-driven, not deterministic.**

When `shortcuts_execute` (MCP tool) is called or the user types `/command`:

1. The shortcut's `prompt` text is looked up and substituted for the `[[shortcut:id:name]]` token.
2. The prompt is sent as a user message to a new Claude session in a new sidepanel window:
   ```
   EXECUTE_TASK { prompt, taskName, windowSessionId, isScheduledTask }
   ```
3. Claude reads the natural-language prompt (which may contain elicitation questions and semantic descriptions like "Navigate to the pricing page and enter the price"), then issues tool calls (`navigate`, `click`, `type`, etc.) through its normal agentic loop.
4. **Element re-identification** is done by Claude at replay time using the accessibility-tree + page-reading tools (see doc 03). The recorded CSS selectors are embedded in the prompt description only if explicitly mentioned; more typically the prompt is semantic ("Click the submit button") and Claude finds the element itself.

### Scheduled execution

`chrome.alarms` (key = prompt id, e.g. `prompt_1234567890`) fires on schedule. The service worker (`service-worker.ts-BsAUV92e.js`) reads `savedPrompts`, creates a new Chrome window with the target URL, opens a popup sidepanel window, and sends `EXECUTE_TASK`.

---

## g. Libraries

| Library | Role | File |
|---------|------|------|
| **Datadog RUM / Session Replay SDK** | Records DOM mutations/events for Anthropic's own product analytics. Uses `MutationObserver`, full DOM serialization (`type: 0` full snapshot, `type: 1` incremental), scroll, mouse, input observers. | `startRecording-DT2Ni7PN.js`, `useStorageState-C6Ou-D0H.js` |
| **Web Speech API** (browser built-in) | `SpeechRecognition` / `webkitSpeechRecognition`, `continuous=true`, `interimResults=true` | `sidepanel-BL0NRfq2.js` |
| **`chrome.scripting.executeScript`** | Injects click/keystroke capture into tab | `sidepanel-BL0NRfq2.js` |
| **Canvas 2D** | Annotates screenshot with blue circle at click point | `sidepanel-BL0NRfq2.js` |
| **`chrome.alarms`** | Schedules recurring/one-time shortcut runs | `service-worker.ts-BsAUV92e.js`, `PermissionManager-BBDx9xIl.js` |
| **TipTap** (ProseMirror) | Rich text editor for shortcut prompt editing | `sidepanel-BL0NRfq2.js` |

**No rrweb** is used for workflow recording. The Datadog SDK in `startRecording-DT2Ni7PN.js` is superficially rrweb-like (it uses `MutationObserver` + DOM serialization types 0/1/2/3/4) but it uploads to Datadog's own ingestion endpoint, not to any workflow store.

Identifying string from Datadog bundle:
```
/(datadog|ddog|datad0g|dd0g)/.test(f)
```

---

## h. Reusable vs Claude-Specific + Rebuild Notes

### What is Claude-specific

| Component | Why it's tied to Claude |
|-----------|------------------------|
| `generateWorkflowSummary` | Calls `claude-sonnet-4-5-*` directly via `createAnthropicMessage` |
| `generateWorkflowStepDescription` | Same — per-step AI enhancement |
| `shortcuts_execute` MCP tool | Injects prompt as user message into Claude session |
| Shortcut scheduling | Trivially reusable (chrome.alarms + stored prompt text) |

### What is reusable as-is

| Component | Notes |
|-----------|-------|
| **Click/keystroke capture** (`W5`) | Pure `chrome.scripting.executeScript` + messaging. Drop-in reusable. |
| **Screenshot + annotation** | Standard `captureVisibleTab` + Canvas — reusable. |
| **Navigation/tab event capture** | Standard chrome extension APIs — reusable. |
| **`[[shortcut:id:name]]` token format** | Simple `[[...]]` regex pattern; easy to reimplement. |
| **`SavedPrompt` schema** | Plain JSON in `chrome.storage.local` — reusable schema. |
| **Scheduling via `chrome.alarms`** | Works unchanged with any LLM backend. |

### Rebuild notes for OpenRouter + generic MCP server

1. **Capture layer**: Copy the `W5.injectElementSelector` pattern verbatim — it produces a rich `RecordingStep[]` with selectors, element metadata, screenshots, and keystrokes. This is the key innovation.

2. **Synthesis step**: Replace `generateWorkflowSummary` with an OpenRouter call using the same system prompt. The system prompt (quoted above in §e) is detailed and well-designed; use it verbatim with minor model-name changes.

3. **Per-step enhancement**: `generateWorkflowStepDescription` (64-token call per click) is optional polish. Feasible with any fast small model via OpenRouter.

4. **Storage**: Keep the `savedPrompts` / `chrome.storage.local` schema unchanged — no dependency on Claude infrastructure.

5. **Replay**: The replay is just "send the prompt as a user message and let the agent run". Any agentic loop that can call browser tools will work. No deterministic replay engine is needed.

6. **Speech narration**: `SpeechRecognition` is browser-native, fully reusable unchanged.

7. **Selector strategy**: The captured CSS selectors (`#id`, `.class.list`, `[aria-label]`, tag `:contains(text)`) serve as hints in the generated prompt. For maximum reliability on replay, embed selectors explicitly in the synthesised prompt or pass them as structured data to the replaying agent.

---

## i. Open Questions

1. **Are step screenshots ever stored?** Evidence says screenshots are stripped on save (the `saveWithoutScreenshots=true` flag in `F3`'s `j` callback strips them with `{ ...e, screenshot: undefined }`). But `f3` (the shortcut editor) receives a `{prompt}` object, not steps — so the steps with screenshots are discarded after synthesis. Uncertain whether any intermediate storage occurs.

2. **Is the Datadog session-replay data used to power any "Teach Claude" feature?** The Datadog SDK uploads to Datadog servers, not to any local store, so the answer appears to be no — but the initiation condition (the `apiKey: "hcaik_01k4..."` in `PermissionManager`) is in extension code, so Anthropic could theoretically correlate sessions.

3. **How are multi-tab workflows handled at replay?** The capture tracks multiple tabs (via `tabGroupId` grouping), but the stored prompt is flat text. The replaying agent would need to open tabs itself based on semantic cues; there is no structured tab-graph in the artifact.

4. **`generateShortcutName` model**: Uses `modelClass: "small_fast"` — unclear which exact model this resolves to at runtime; likely Haiku or equivalent.

5. **Size limits**: No explicit chunking was observed for the `savedPrompts` array. Very long recordings (many steps, verbose descriptions) could approach `chrome.storage.local` limits (10 MB total, 8 KB per item for `sync`; `local` is effectively unbounded). No guard was seen.
