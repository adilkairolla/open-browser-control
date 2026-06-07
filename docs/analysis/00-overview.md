# Claude-in-Chrome (v1.0.75) — Reverse-Engineering Overview

Analysis of the unpacked extension at `.var/1.0.75_0` (git hash `f0156cfe…`), produced
by five parallel analysis passes. This is the index; each section links to a detail doc.

> **Why we did this:** we are building `open-browser-control` — the same browser-control
> capability, but driven by **OpenRouter models + a generic MCP server** so *any* harness
> can control the browser, with no Anthropic infrastructure. The headline finding is that
> **Claude already ships exactly this architecture for its local path** (a native-messaging
> host speaking a generic JSON tool protocol), which validates the transport we chose.

Detail docs:
- [`01-tools-and-schemas.md`](01-tools-and-schemas.md) — the tool catalog + JSON schemas + execution mapping
- [`02-transport-and-bridge.md`](02-transport-and-bridge.md) — bridge WebSocket, native messaging, message envelope, routing
- [`03-page-perception.md`](03-page-perception.md) — accessibility tree, screenshots, coordinate mapping
- [`04-permissions-and-safety.md`](04-permissions-and-safety.md) — consent model, blocking, org policy
- [`05-features-and-ui.md`](05-features-and-ui.md) — full user-facing feature inventory
- [`06-service-worker-and-background.md`](06-service-worker-and-background.md) — background orchestration: lifecycle, keepalive, debugger session, DNR rules
- [`07-storage-and-state.md`](07-storage-and-state.md) — persisted-state schema (storage keys, data model, where tokens live)
- [`08-mcp-protocol.md`](08-mcp-protocol.md) — is it real MCP? (no) + how tools are exposed; the `_mcp` suffix
- [`09-workflow-recording.md`](09-workflow-recording.md) — "Teach Claude" capture → synthesis → model-driven replay
- [`10-telemetry-and-observability.md`](10-telemetry-and-observability.md) — analytics/crash/tracing inventory + strip-list

---

## 1. High-level architecture

```
                        ┌─────────────────────── control channels (pick one) ───────────────────────┐
                        │                                                                            │
  ┌───────────────┐     │   A) hosted relay                          B) local native messaging      │
  │  AI harness   │─────┤   wss://bridge.claudeusercontent.com       com.anthropic.claude_code_      │
  │ (claude.ai /  │     │   /chrome/<device_id>                      browser_extension  (stdio)      │
  │  Claude Code /│     │        │  JSON: tool_call / tool_result          │  JSON: tool_request /    │
  │  Desktop)     │     │        │                                         │  tool_response + MCP     │
  └───────────────┘     │        ▼                                         ▼  lifecycle               │
                        └───────────────────────────┬────────────────────────────────────────────────┘
                                                     ▼
                                  ┌──────────────────────────────────────┐
                                  │   Service worker (orchestrator)       │
                                  │   - routes tool calls                 │
                                  │   - PermissionManager gate            │
                                  │   - per-tab CDP session manager       │
                                  └───────┬───────────────────┬──────────┘
                          chrome.debugger │                   │ chrome.scripting.executeScript
                          (CDP commands)  ▼                   ▼ (inject into page)
                              ┌────────────────────┐   ┌──────────────────────────────────┐
                              │  Target tab (CDP)  │   │  Content scripts (all_urls):      │
                              │  Input.dispatch*,  │   │  - accessibility-tree.js          │
                              │  Page.captureScreen│   │      __generateAccessibilityTree()│
                              │  shot, Runtime.eval│   │      → window.__claudeElementMap  │
                              └────────────────────┘   │  - agent-visual-indicator.js      │
                                                       └──────────────────────────────────┘
        Side panel (React UI, Ctrl+E)  ◀── chrome.runtime ──▶  Service worker
        Offscreen document  ◀── only for client-side GIF export (gif.js)
```

**Two interchangeable control channels** carry the *same* application-layer protocol
(generic JSON, a `type`/`tool` discriminator — **not** Anthropic's `computer_use` API type):

- **(A) Hosted relay** — `wss://bridge.claudeusercontent.com/chrome/<device_id>`, authenticated
  with a claude.ai OAuth token. Used by the cloud/web harness.
- **(B) Local native messaging** — host names `com.anthropic.claude_browser_extension` and
  `com.anthropic.claude_code_browser_extension`; full tool control over stdio plus MCP
  lifecycle signals (`mcp_connected`/`mcp_disconnected`). Used by the local Claude Code CLI /
  Desktop app. **This is the path we are replicating.**

The extension tries both native hosts at startup and uses whichever answers a `ping`.

See [`02-transport-and-bridge.md`](02-transport-and-bridge.md).

---

## 2. The tool surface (the "schema")

**23 tools**, custom JSON Schemas any model can consume. Every tool takes an explicit `tabId`.

| Group | Tools |
|---|---|
| Input / output | `computer` (13 actions: screenshot, click variants, type, key, scroll, drag, hover, mouse_move, scroll_to, …), `navigate`, `javascript_tool`, `upload_image`, `file_upload`, `resize_window`, `gif_creator` |
| DOM inspection | `read_page`, `find`, `get_page_text`, `read_console_messages`, `read_network_requests`, `form_input` |
| Tab management | `tabs_context`, `tabs_context_mcp`, `tabs_create`, `tabs_create_mcp`, `tabs_close_mcp` |
| Meta / orchestration | `browser_batch` (run several tools in one call), `update_plan`, `shortcuts_list`, `shortcuts_execute`, `turn_answer_start` |

**Execution mechanisms (two):**
1. **CDP via `chrome.debugger.sendCommand`** — all pointer/keyboard/screenshot actions
   (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Page.captureScreenshot`, `Runtime.evaluate`).
2. **`chrome.scripting.executeScript`** — calls the injected `window.__generateAccessibilityTree()`,
   which populates `window.__claudeElementMap` (a `WeakRef` store of live DOM nodes) exposed as
   `ref_1`, `ref_2`, … Element-targeting tools (`find`, `form_input`, `file_upload`, `upload_image`,
   `computer:scroll_to`) resolve a `ref_N` to live coordinates at action time.

Full per-tool JSON schemas: [`01-tools-and-schemas.md`](01-tools-and-schemas.md).

---

## 3. How a page is represented for the model

Two independent channels (see [`03-page-perception.md`](03-page-perception.md)):

- **Accessibility tree** (`read_page`) — a *custom* DOM walk (not the Chrome a11y API) →
  compact indented text: `role "name" [ref_N] href="…" type="…"`. Limits: 10k nodes, depth 15,
  50k chars. The `find` tool feeds this text to a cheap LLM sub-call to pick relevant `ref_N`s.
- **Screenshot** — CDP `Page.captureScreenshot` (`fromSurface:true`, viewport `clip`), JPEG base64,
  downscaled to a vision token budget (`pxPerToken=28`, `maxTargetPx=1568` — Claude-specific
  constants). Click coordinates are remapped screenshot-space → CSS-viewport-space via
  `De(x,y) = [round(x·viewportW/shotW), round(y·viewportH/shotH)]` using a per-tab context stored
  after each screenshot. Overlays are hidden during capture.

**Element identity is dual: `ref_N` (WeakRef map) for DOM-level targeting, pixel coords for
vision-level targeting.** The `accessibility-tree.js` content script (~7KB, zero Anthropic deps)
is the single most reusable component in the codebase.

---

## 4. Permission & safety model

Hostname-scoped consent (see [`04-permissions-and-safety.md`](04-permissions-and-safety.md)):

- **Scope:** `netloc` (hostname) + `domain_transition` (from→to). One approval per host covers all
  action types. **Duration:** `once` (consumed by `toolUseId`, non-replayable) or `always`
  (persisted in `chrome.storage.local` → `permissionStorage`, user-revocable).
- **Modes:** `follow_a_plan` (default — approve a plan + its domains up front), `ask` (prompt on
  every action; forced for sensitive sites, "always allow" disabled), `skip_all_permission_checks`
  ("Act without asking", behind a multi-step HIGH-RISK confirmation).
- **Blocking:** (1) managed-policy `blockedUrlPatterns` (wildcard match on `hostname+pathname`);
  (2) Anthropic cloud `url_hash_check` API categorizing sites (hard block → `blocked.html`,
  sensitive → forced prompts, org-blocked). **(2) is Anthropic-specific.**
- **`browser_batch` fails fast** if any sub-action needs a prompt.

---

## 5. Feature inventory (what the product does)

See [`05-features-and-ui.md`](05-features-and-ui.md). Headlines:

- **Side-panel chat** (React, Ctrl+E) + agent/browser-control mode.
- **Workflow recording ("Teach Claude")** — record a demo (rrweb-style DOM serialization +
  speech-to-text) → Claude produces a replayable automation. The most complex feature.
- **GIF export** — annotated action frames composited client-side in the offscreen document (gif.js).
- **Rich chat rendering** — Mermaid (20+ diagram types), Wardley maps, Cytoscape, KaTeX, runnable HTML artifacts.
- **Connectors** — Google Workspace / Microsoft 365 / Slack via Anthropic-hosted MCP servers; experimental **Cowork** (local FS + terminal via a native host).
- **Plan-before-act**, scheduled **shortcuts**, notifications + sound, conversation compaction.

---

## 5b. Background service-worker orchestration

See [`06-service-worker-and-background.md`](06-service-worker-and-background.md). The MV3 service
worker is more than a tool router — it runs critical background machinery:

- **Keepalive (3 layers, the most important non-obvious plumbing):** a **persistent offscreen
  document** (`reason: AUDIO_PLAYBACK + BLOBS`, justification *"Keep service worker alive, play
  notification sounds, generate GIFs"*) pings `SW_KEEPALIVE` every 20s; a **`bridge-keepalive`
  alarm** (`periodInMinutes: 0.5`) pings/reconnects the bridge + refreshes OAuth every 30 min; and
  the **long-lived native-messaging port** keeps the SW alive as a side effect. Without this the
  SW dies after any ~30s tool gap mid-session.
- **Debugger (CDP) session lifecycle:** lazy-attach on first tool call per tab (`Page.enable`),
  auto-detach ~20s after the last tool, reattach on next command, state preserved across SW
  restarts in `globalThis.__cdp*`.
- **declarativeNetRequest:** one session rule injecting client-id headers on `api.anthropic.com`
  (`anthropic-client-platform`, `anthropic-client-version`, extended `User-Agent`) — **Anthropic-specific.**
- **Lifecycle:** install/update/startup sets up device-id, default settings, the DNR rule, and
  onboarding; `webNavigation.onBeforeNavigate` tracks navigations; `commands.onCommand` toggles the
  side panel (Ctrl/Cmd+E).

## 5c. Storage, MCP-reality, recording, telemetry (docs 07–10)

- **Storage (07):** a single flat `chrome.storage.local` namespace keyed by a `StorageKey` enum
  (~42 keys). No IndexedDB, no sync, **no encryption at rest** — OAuth `accessToken`/`refreshToken`
  are plaintext. **Chat history is NOT persisted** (ephemeral React state); the only stored
  message arrays are `scheduledTaskLogs`. Notably an `anthropicApiKey` key *and* a `selectedModel`
  key already exist — API-key + model-selection scaffolding is present. For our rebuild the
  essential state collapses to ~9 keys (swap `anthropicApiKey` → `openrouterApiKey`).

- **MCP reality (08) — important correction:** the extension does **NOT** implement MCP. There is
  no `tools/list` / `tools/call` / `initialize`; `"jsonrpc"` appears once on a fire-and-forget
  notification. The bridge/native-messaging protocol is the **custom** flat `tool_call`/`tool_result`
  envelope (doc 02); `mcp_connected` are just lifecycle hints. The `_mcp` tool suffix
  (`tabs_*_mcp`) is **tab-group isolation** for harness sessions, not an MCP marker — it's the
  mandatory bootstrap before other tools. Real MCP translation happens *outside* the extension, in
  the native-host binary (not shipped here). ⇒ **Our MCP server is the first component in this
  stack to speak real MCP** — exactly the gap our project fills.

- **Workflow recording (09) — correction:** the recorder is **not rrweb**, and
  `startRecording-DT2Ni7PN.js` is actually the **Datadog Session-Replay SDK** (telemetry), *not*
  the "Teach Claude" recorder. The real recorder is an injected capture script (click→selector,
  keystrokes, `captureVisibleTab`+canvas annotation, navigation tracking, Web Speech narration)
  producing `RecordingStep[]`, which a `claude-sonnet-4-5` call **synthesizes into a natural-language
  `SavedPrompt`** (with `<inputs>` placeholders). **Replay is model-driven** (Claude re-derives tool
  calls), not deterministic event replay. Capture layer is model-agnostic and reusable; only the
  synthesis call is Claude-specific.

- **Telemetry (10):** Segment (→Amplitude/Iterable), Sentry, Honeycomb (OTel), Datadog RUM. ~17
  runtime events. PII that leaves the browser: account UUID, active-tab domain, traceparent headers
  (`forceTrace=true`), token counts — **message text does not**. Doc 10 has a concrete strip-list
  (no-op 3 init calls, stub Segment, remove trace injection, drop 4 origins from CSP).

## 6. What this means for `open-browser-control`

| Layer | Claude-in-Chrome | Our rebuild |
|---|---|---|
| **Control transport** | Native messaging host (local) **or** hosted wss bridge | **Native messaging host** (already chosen) ↔ MCP server — mirror Claude's local path |
| **Wire protocol** | **Custom** flat `tool_call`/`tool_result` JSON over the bridge/native messaging — *not* MCP (doc 08); real MCP only exists outside, in the native-host binary | Our MCP server speaks **real MCP** (`initialize`/`tools/list`/`tools/call`) to the harness, and the custom `tool_call`/`tool_result` envelope (our `@obc/shared` types) down to the extension. We *are* the missing MCP translator. |
| **Tool schemas** | 23 custom JSON-Schema tools (not `computer_use` type), key `input_schema` | Reuse the catalog as MCP `tools/list` (rename `input_schema`→`inputSchema`). Custom schemas ⇒ works with **any** OpenRouter model; keep the `_mcp` tab-group bootstrap contract |
| **Execution** | `chrome.debugger` (CDP) + `chrome.scripting` | Same — needs `debugger` + `scripting` + `<all_urls>` in our manifest |
| **Page perception** | custom a11y tree (`ref_N` WeakRef map) + CDP screenshot + coord remap | Port `accessibility-tree.js` ~verbatim; reuse the ref system + `De()` remap |
| **Permissions** | hostname-scoped, 3 modes, once/always | Reproduce the **per-action prompt + hostname persistence + non-replayable `once` tokens**; drop the Anthropic `url_hash_check` cloud call |
| **Storage** | flat `chrome.storage.local`, ~42 keys, plaintext tokens, no chat history persisted | ~9 keys; `anthropicApiKey`→`openrouterApiKey`; reuse `selectedModel`, `permissionStorage`, `savedPrompts`, `scheduledTaskLogs` |
| **Model layer** | Anthropic API / claude.ai; `selectedModel` + `anthropicApiKey` keys already exist | **OpenRouter** — model-agnostic; vision constants (`pxPerToken=28`, `maxTargetPx=1568`) become per-model config |
| **Telemetry** | Segment/Sentry/Honeycomb/Datadog; UUID + tab-domain leave the browser | **Strip entirely** (doc 10 strip-list); no phone-home |
| **Drop entirely** | claude.ai SSO, hosted bridge, Anthropic MCP connectors, artifact remix, telemetry (Segment/Sentry/Honeycomb/Datadog), onboarding-on-claude.ai | Not needed |

**The critical, non-trivial pieces to get right** (everything else is standard Chrome APIs):
1. `__generateAccessibilityTree()` + the `ref_N` WeakRef element map — the bridge between
   NL-level tools and action tools.
2. The screenshot capture + coordinate-remap pipeline.
3. The per-action, hostname-scoped permission gate with non-replayable `once` tokens.
4. A native-messaging ⇄ MCP-server relay speaking the `tool_call`/`tool_result` envelope.
5. The **MV3 keepalive** (persistent offscreen document + alarm) so the service worker survives
   gaps between tool calls during a session — and per-tab CDP attach/detach lifecycle.

> ⚠️ **Provenance caveat:** all findings above are derived from a **minified production bundle**.
> String literals (tool names, URLs, schema keys, CDP commands) are reliable; reconstructed
> control flow and any field not directly quoted should be re-verified against live behavior
> before being treated as exact. Per-doc "open questions" sections list the low-confidence items.
