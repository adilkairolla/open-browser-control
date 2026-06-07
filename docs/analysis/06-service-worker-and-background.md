# 06 — Service Worker & Background Orchestration

**Extension version:** 1.0.75  
**Sources analysed (read-only):**
- `assets/service-worker.ts-BsAUV92e.js` (17 KB, SW entry point)
- `assets/mcpPermissions-8PlHLvdl.js` (281 KB minified)
- `assets/PermissionManager-BBDx9xIl.js` (345 KB minified)
- `offscreen.js` (unminified — comments intact)
- `offscreen.html`, `manifest.json`

---

## (a) Summary

The MV3 service worker is a single-file entry point (`service-worker-loader.js` → `service-worker.ts-BsAUV92e.js`) that dynamically imports two large chunks. It acts as a routing hub: it registers every Chrome event listener, then delegates all substantive logic into the two chunks. The SW keeps itself alive through a three-layer keepalive strategy (offscreen document + periodic alarm + in-flight port). The extension maintains two independent "transport" connections — a native-messaging pipe and a WebSocket bridge — and coordinates per-tab CDP debugger sessions, tab grouping, side-panel lifecycle, scheduled-prompt alarms, and OAuth token management entirely from the background context.

---

## (b) Event listener / responsibility table

| Chrome API event | Handler action | Primary file |
|---|---|---|
| `chrome.runtime.onInstalled` | Clear `updateAvailable` storage key; set uninstall survey URL; init Segment analytics; init TabGroupManager; install DNR session rules; on `INSTALL` reason: open OAuth flow; reconnect native host; restore scheduled prompt alarms | SW entry |
| `chrome.runtime.onStartup` | Init Segment analytics; install DNR session rules; init TabGroupManager; reconnect native host bridge; restore scheduled prompt alarms | SW entry |
| `chrome.runtime.onUpdateAvailable` | Write `updateAvailable=true` to storage; emit `claude_chrome.extension.update_available` telemetry | SW entry |
| `chrome.runtime.onMessage` (internal) | Route whitelisted message types (see §b-2 below) — keepalive, oauth refresh, sound playback, side-panel open, logout, native-host status, MCP notification forwarding, scheduled task execution, agent stop, tab switching, heartbeat | SW entry |
| `chrome.runtime.onMessageExternal` | Accept only from `https://claude.ai`; handle `oauth_redirect` (exchange code, reconnect bridge) and `ping` | SW entry |
| `chrome.permissions.onAdded` | If `nativeMessaging` added: connect native host | SW entry |
| `chrome.permissions.onRemoved` | If `nativeMessaging` removed: disconnect native host, reset flags | SW entry |
| `chrome.action.onClicked` | Open side panel for the active tab | SW entry |
| `chrome.commands.onCommand` | `toggle-side-panel` → open side panel for active tab | SW entry |
| `chrome.tabs.onRemoved` | Notify TabGroupManager (`handleTabClosed`) to clean up group state | SW entry |
| `chrome.webNavigation.onBeforeNavigate` | Frame 0 only: intercept `clau.de` deep-link URLs (permissions, reconnect, tab-focus) | SW entry |
| `chrome.webNavigation.onCommitted` | If the navigating tab has an active tool call: re-evaluate permissions, reset tool state | mcpPermissions chunk |
| `chrome.alarms.onAlarm` | Route by name: `bridge-keepalive` → WS ping/reconnect/token-refresh; `prompt_*` → run scheduled task; `retry_*` → reschedule monthly/annual prompt | SW entry + mcpPermissions chunk |
| `chrome.notifications.onClicked` | Parse `tabId` from notification ID; focus that window and tab, or focus current window | SW entry |
| `chrome.debugger.onEvent` | Handle CDP events: `Page.javascriptDialogOpening` (beforeunload), `Page.frameNavigated` (cancel waiting) | mcpPermissions chunk |
| `chrome.debugger.onDetach` | Release beforeunload waiters for the detached tab | mcpPermissions chunk |

### b-2 Internal message type whitelist

```
SW_KEEPALIVE
check_and_refresh_oauth
PLAY_NOTIFICATION_SOUND
open_side_panel
logout
check_native_host_status
SEND_MCP_NOTIFICATION
OPEN_OPTIONS_WITH_TASK
EXECUTE_SCHEDULED_TASK
STOP_AGENT
SWITCH_TO_MAIN_TAB
SECONDARY_TAB_CHECK_MAIN
MAIN_TAB_ACK_RESPONSE
STATIC_INDICATOR_HEARTBEAT
DISMISS_STATIC_INDICATOR_FOR_GROUP
```

Only these message types cause the `onMessage` listener to return `true` (async). Any unlisted type is silently ignored — this prevents arbitrary pages from waking the SW.

---

## (c) Lifecycle: install / update / startup

### Fresh install (`OnInstalledReason.INSTALL`)

1. `chrome.storage.local.remove(["updateAvailable"])` — clear stale flag.
2. `chrome.runtime.setUninstallURL("https://docs.google.com/forms/d/e/1FAIpQLSdLa1wTVkB2ml2abPI1FP9KiboOnp2N0c3aDmp5rWmaOybWwQ/viewform")` — uninstall feedback survey.
3. `Ro()` — initialise Sentry error reporting (DSN: `https://60bea3ee4ef1022e4035b23ba50f44d0@o1158394.ingest.us.sentry.io/4509876992278529`).
4. `Ne()` — **initiate OAuth PKCE flow**: generate `state` + `code_verifier`, write both to `chrome.storage.local` (keys `oauthState`, `codeVerifier`), open `https://claude.ai/oauth/authorize?…` in a new tab. On success redirects to `chrome-extension://{id}/oauth_callback.html`.
5. `TabGroupManager.initialize()` — load group state from storage, reconcile with Chrome's live tab groups.
6. `F()` — install declarativeNetRequest session rules (see §e).
7. `R()` — connect native messaging host.
8. `H()` — restore scheduled prompt alarms from `savedPrompts` storage.

### Extension update (`onInstalled` with `UPDATE` / `CHROME_UPDATE`)

Same as fresh install **except** step 4 (OAuth) is skipped. State flags (`updateAvailable`) are cleared. `onUpdateAvailable` fires separately and sets `updateAvailable=true` in storage.

### Browser startup (`onStartup`)

1. Sentry init.
2. DNR rules reinstalled (session rules don't survive restarts).
3. TabGroupManager re-initialised.
4. Bridge reconnect (`mn()`).
5. Native host reconnect (`R()`).
6. Scheduled alarms restored (`H()`).

---

## (d) Keepalive strategy (detailed — critical for rebuild)

MV3 service workers terminate after ~30 s of idle. This extension uses **three concurrent mechanisms** to prevent termination while any active session is running:

### Layer 1 — Persistent offscreen document (primary keepalive)

```javascript
// mcpPermissions chunk, function Xe() — createDocument singleton
chrome.offscreen.createDocument({
  url: "offscreen.html",
  reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.BLOBS],
  justification: "Keep service worker alive, play notification sounds, generate GIFs"
})
```

`Xe()` is a singleton (uses a `Ye` promise guard with `.finally(() => Ye = undefined)` to reset on completion). It is called:
- At SW top-level startup (module evaluation, `c().catch(() => {})`)
- Before each `PLAY_NOTIFICATION_SOUND` message handling (`await c()`)

The offscreen document itself (unminified `offscreen.js`) runs a `setInterval` every **20 000 ms (20 s)** that sends `{ type: "SW_KEEPALIVE" }` to the SW:

```javascript
// offscreen.js (comment in source):
// "SW keepalive — offscreen docs aren't subject to MV3's 30s idle kill. A
// message every 20s resets the SW's idle timer, keeping the bridge WS
// setInterval ping running under background throttle/freeze."
setInterval(() => {
  chrome.runtime.sendMessage({ type: "SW_KEEPALIVE" }).catch(() => {});
}, 20_000);
```

The `SW_KEEPALIVE` message type is in the whitelist, so the `onMessage` listener returns `true` (async), which is itself a keepalive signal to the browser runtime.

**This is the critical layer**: the offscreen document cannot be killed by the 30 s idle timer (only by explicit `chrome.offscreen.closeDocument()`), so it acts as a persistent heartbeat source.

### Layer 2 — `bridge-keepalive` alarm (secondary / bridge-specific)

Created in `mcpPermissions` function `kn()`, called at SW startup as `i()`:

```javascript
// Only in ServiceWorkerGlobalScope:
chrome.alarms.create("bridge-keepalive", { periodInMinutes: 0.5 })  // every 30 s
```

The alarm handler (also in `kn()`):
1. If the WebSocket reconnect timer has elapsed or is null: call `mn()` (reconnect).
2. If the WebSocket is open:
   - If last pong was more than **90 000 ms (90 s) ago**: close socket with code 4001 (`"pong-timeout"`), emit telemetry.
   - Otherwise: send `{ type: "ping" }` JSON to the WebSocket.
3. If more than **1 800 000 ms (30 min)** since last token refresh: call `g()` (= `checkAndRefreshOAuthTokenIfNeeded`).

Additionally, when the WebSocket connection opens, `hn()` starts an in-process `setInterval` every **20 000 ms (20 s)** that also sends WebSocket pings. This is stopped by `pn()` when the socket closes.

> **Note:** Alarms fire in the SW context, waking the SW if it was dormant. The 30 s alarm interval is itself a keepalive mechanism, but coarser than the offscreen document approach. Both run simultaneously.

### Layer 3 — Long-lived native messaging port (opportunistic)

When the native messaging host is connected, `N` (the `chrome.runtime.Port`) is kept open. An open port prevents SW termination for as long as it is connected. This is a side effect of the MCP integration, not an explicit keepalive, but it provides keepalive for free during active MCP sessions.

### Keepalive for our rebuild

We do not need Anthropic's OAuth. But we do need:
1. A persistent offscreen document that pings the SW every ≤20 s.
2. A periodic alarm (≤30 s) to wake the SW if it was killed and to monitor WebSocket health.
3. A long-lived port (native messaging or WebSocket) during active control sessions.

---

## (e) declarativeNetRequest session rules

Function `F()`, called on every install and startup:

```javascript
const rules = [{
  id: 1,
  priority: 1,
  action: {
    type: RuleActionType.MODIFY_HEADERS,
    requestHeaders: [
      {
        header: "User-Agent",
        operation: HeaderOperation.SET,
        value: `claude-browser-extension/${version} (external) ${version} ${navigator.userAgent} `
      },
      {
        header: "anthropic-client-platform",
        operation: HeaderOperation.SET,
        value: "claude_browser_extension"
      },
      {
        header: "anthropic-client-version",
        operation: HeaderOperation.SET,
        value: version  // e.g. "1.0.75"
      }
    ]
  },
  condition: {
    urlFilter: "https://api.anthropic.com/*",
    resourceTypes: [ResourceType.XMLHTTPREQUEST, ResourceType.OTHER]
  }
}]
await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: rules })
```

**Purpose:** Every XHR/fetch request from the extension to the Anthropic API (`https://api.anthropic.com/*`) gets three headers injected:
- `User-Agent`: extended with extension version + browser UA string.
- `anthropic-client-platform: claude_browser_extension` — identifies the client type on the server side for billing/routing.
- `anthropic-client-version: 1.0.75` — allows server-side version gating.

These are **session rules** (not static/dynamic), so they are re-applied on every SW restart/startup. Rule ID 1 is always removed first to prevent duplicates.

**For our rebuild:** This rule is entirely Anthropic-specific. Replace with equivalent headers for your chosen inference provider (e.g. `X-OpenRouter-*` headers if using OpenRouter). The mechanism (DNR session rule applied at startup) is the right pattern.

---

## (f) Debugger (CDP) session lifecycle

### Attach

`Y.attachDebugger(tabId)` (class method, `Y = ChromeDebuggerManager`):
1. Deduplicates concurrent attach calls via an `attachInFlight` Map (returns existing promise if already attaching).
2. Calls `attachDebuggerImpl(tabId)`:
   - Rejects `chrome:` and `chrome-extension:` URLs immediately with a clear error.
   - Calls `detachDebugger(tabId)` first (to clean up any stale attachment).
   - Calls `rawAttach(tabId)`: `chrome.debugger.attach({tabId}, "1.3", ...)` with a configurable timeout (default from `a()`, appears to be several seconds). On timeout: error message mentions `"DevTools may be open on this tab, or the renderer may have crashed"`.
   - If another extension is interfering (error message contains `"Cannot access a chrome-extension:// URL of different extension"`): calls `P(tabId, retryFn, error)` which attempts to strip conflicting extension iframes from the page and retries the attach (up to 4 times with 75 ms settle).
   - If attach succeeds: registers event handlers (`Page.enable`, optionally `Runtime.enable`, `Network.enable`).

### State preservation across SW restarts

All CDP state is stored in `globalThis` properties (survive SW restarts within the same Chrome session):
```
globalThis.__cdpDebuggerListenerRegistered  (boolean)
globalThis.__cdpConsoleMessagesByTab         (Map)
globalThis.__cdpNetworkRequestsByTab         (Map)
globalThis.__cdpNetworkTrackingEnabled       (Set)
globalThis.__cdpConsoleTrackingEnabled       (Set)
globalThis.__cdpBeforeunloadPolicyByTab      (Map)
globalThis.__cdpBeforeunloadOutcomeByTab     (Map)
globalThis.__cdpBeforeunloadWaitersByTab     (Map)
globalThis.__cdpRecentCaptureAttempts        (Map)
```

Event listener registration is also checked via `globalThis.__cdpDebuggerListenerRegistered` to avoid double-registering on hot restarts.

### Active-tool tracking

- When a tool call starts for a tab: `es.set(tabId, {toolName, requestId, startTime, errorCallback})`.
- When a tool call completes: `os(tabId, result)`:
  - Removes from `es`.
  - Schedules a **20 000 ms (20 s)** deferred `detachDebugger(tabId)` via `ts.set(tabId, timeoutId)`.
  - Also calls `j.addCompletionPrefix(tabId)` (updates visual indicator).
- When a new tool starts on the same tab: `as(tabId)` cancels the pending detach timer.
- On group cleanup (`ns()`): calls `as(mainTabId)` for all groups, cancelling all pending detach timers.

**Net effect:** The debugger stays attached for up to 20 s after the last tool call on a tab, then auto-detaches. This avoids the visible Chrome "debugging banner" remaining up forever, while allowing rapid back-to-back tool calls without detach/reattach overhead.

### Detach handling

`chrome.debugger.onDetach` listener (also stored in `globalThis.__cdpDebuggerDetachHandler` for restart-safety):
- If the tab had a pending `beforeunload` waiter: resolves it immediately (treats as dismissed).
- Does NOT automatically reattach (reattachment happens next time `attachDebugger` is called).

`sendCommand` auto-heals: if a command fails with `"debugger is not attached"` or `"detached while handling command"`, it calls `attachDebugger(tabId)` and retries once.

### The "Chrome is being debugged" banner

This extension uses `chrome.debugger` which shows Chrome's yellow "DevTools" banner. The extension does NOT suppress this banner (there is no known programmatic way to do so). The 20 s auto-detach minimises how long it is visible.

---

## (g) Offscreen document lifecycle

### Creation

`Xe()` in the `mcpPermissions` chunk:
```javascript
let Ye;
function Xe() {
  return Ye ??= (async () => {
    if (chrome.offscreen) {
      if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.BLOBS],
          justification: "Keep service worker alive, play notification sounds, generate GIFs"
        });
      }
    }
  })().finally(() => { Ye = undefined });
  return Ye;
}
```

**Singleton pattern:** `Ye` caches the in-flight promise. Multiple concurrent calls to `Xe()` return the same promise. After resolution (success or failure), `Ye` is reset to `undefined` so future calls re-check `hasDocument()`.

**Reasons declared:**
- `AUDIO_PLAYBACK` — play notification sounds.
- `BLOBS` — create blob URLs for GIF export.

**Justification string (literal):** `"Keep service worker alive, play notification sounds, generate GIFs"`

### Document content (`offscreen.html` / `offscreen.js`)

The offscreen document (not minified) loads `gif.js` + `offscreen.js`. It:
1. Runs the 20 s SW_KEEPALIVE setInterval immediately on load.
2. Lazily allocates an `AudioContext` on first sound request.
3. Handles three message types: `OFFSCREEN_PLAY_SOUND`, `REVOKE_BLOB_URL`, `GENERATE_GIF`.

### Teardown

There is no explicit `closeDocument()` call in the analysed code. The offscreen document is **persistent for the extension lifetime** — it is created once and kept alive. This is intentional (as the comment says, it is the primary SW keepalive). If the SW restarts, `Xe()` checks `hasDocument()` before creating, so it does not create duplicates.

---

## (h) Alarms

| Alarm name | Period | Created by | Handler |
|---|---|---|---|
| `"bridge-keepalive"` | `periodInMinutes: 0.5` (30 s) | `kn()` at SW startup | Ping WebSocket; reconnect if needed; refresh OAuth every 30 min |
| `"prompt_{id}"` | Per-schedule: once / 1440 min (daily) / 10080 min (weekly); monthly and annually use `when` only | `PromptManager.updateAlarmForPrompt()` | Execute the saved prompt as a scheduled task |
| `"retry_{promptId}"` | One-shot, `delayInMinutes: 1` | `onAlarm` handler when monthly/annual rescheduling fails | Retry rescheduling the alarm |

### bridge-keepalive alarm handler detail

```
if (reconnectTimerElapsed) mn();  // attempt WebSocket reconnect
if (ws.open) {
  if (Date.now() - lastPong > 90_000) {
    ws.close(4001, "pong-timeout");  // stale socket
  } else {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}
if (Date.now() - lastTokenRefresh > 1_800_000) {
  checkAndRefreshOAuthTokenIfNeeded();
}
```

### Scheduled prompt alarm handler detail

- Alarm name starts with `"prompt_"`: look up `savedPrompts` in `chrome.storage.local` by matching `e.id === alarmName`.
- If found: call `Y(task, runLogId)` — creates a new Chrome window with the target URL, initialises a tab group, opens a sidepanel popup window, waits for it to load (~1 s after `complete`), then sends `{ type: "EXECUTE_TASK", prompt, taskName, runLogId, windowSessionId, isScheduledTask: true }`.
- If `monthly` or `annually`: calls `PromptManager.updateAlarmForPrompt(prompt)` to schedule the next occurrence (these repeat types cannot use `periodInMinutes` and must be rescheduled manually).
- On scheduling failure: creates a retry alarm `"retry_{promptId}"` with 1 min delay; shows a notification.
- Alarm name starts with `"retry_"`: attempt to reschedule the monthly/annual prompt.

---

## (i) Generic plumbing vs Anthropic-specific

### Must reproduce for any generic browser-control extension

| Mechanism | Reason |
|---|---|
| Persistent offscreen document with SW_KEEPALIVE setInterval | MV3 mandatory — SW dies in 30 s without it |
| Periodic alarm (≤30 s) for WS health monitoring | Ensures reconnect even when SW was killed |
| CDP (debugger) session lifecycle: lazy attach, 20 s deferred detach, globalThis state | Required for screenshot, click, navigate, etc. |
| `declarativeNetRequest.updateSessionRules` at startup | Session rules don't survive restarts |
| `tabs.onRemoved` → group/session cleanup | Prevents stale state |
| `webNavigation.onBeforeNavigate` frame-0 intercept | Required for deep-link protocol routing |
| TabGroupManager (chrome tab groups per control session) | Session isolation per user intent |
| `sidePanel.open` / `sidePanel.setOptions` | The UI surface |
| `onMessage` whitelist pattern | Security: prevents arbitrary wake-up |

### Anthropic-specific (replace or remove in rebuild)

| Mechanism | Anthropic coupling |
|---|---|
| DNR rule injecting `anthropic-client-platform` / `anthropic-client-version` headers | Targets `https://api.anthropic.com/*` specifically |
| OAuth PKCE flow to `https://platform.claude.com/v1/oauth/token` | Anthropic identity provider |
| `externally_connectable` to `https://claude.ai/*` | Anthropic web app pairing |
| `onMessageExternal`: `oauth_redirect` / `ping` from `https://claude.ai` | Anthropic web app integration |
| Bridge WebSocket: `wss://bridge.claudeusercontent.com/chrome/{userId}` | Anthropic relay server |
| Native messaging hosts: `com.anthropic.claude_browser_extension`, `com.anthropic.claude_code_browser_extension` | Anthropic desktop apps |
| `chrome_ext_oauth_refresh` / Segment analytics / Sentry DSN | Anthropic telemetry |
| `https://docs.google.com/forms/…` uninstall survey | Anthropic feedback |
| `clau.de` URL scheme interception (`/chrome/permissions`, `/chrome/reconnect`, `/chrome/tab/{id}`) | Anthropic deep-link protocol |
| Pairing flow (WebSocket `pairing_request` / `pairing_response`) | Anthropic desktop app pairing |

**For the rebuild:** Keep the CDP session management, keepalive architecture, tab group model, and DNR rule mechanism. Replace the Anthropic API target in the DNR rule with your inference provider's API hostname. Drop the OAuth, bridge WebSocket, and native messaging entirely; replace with your own MCP-over-native-messaging or direct MCP server protocol.

---

## (j) Open questions

1. **offscreen document teardown:** Is there any code path that calls `chrome.offscreen.closeDocument()`? None was found in the analysed chunks. Unclear whether the document is ever explicitly torn down (e.g. when no session is active and the user wants to reduce resource usage).

2. **bridge reconnect exponential backoff cap:** The backoff cap constant `cn = 3e5` (300 000 ms = 5 min) with formula `min(2000 × 1.5^(attempts-1), 300000)` — does the extension ever reset `Va` (attempt counter) after a stable connection? Found that `Va = 0` is reset in `fn()` (full disconnect), but not on successful reconnect. Long outages could leave `Va` high.

3. **Multiple CDP domain enablement:** `Page.enable` is always called; `Runtime.enable` and `Network.enable` are only called if those tracking flags were previously set. After a SW restart (globalThis survives), if `networkTrackingEnabled` has a tabId in the Set, does the extension correctly re-enable Network domain on reattach? The reattach path (`attachDebuggerImpl`) checks these flags, so it should work — but this was not confirmed via execution trace.

4. **Scheduled task session isolation:** Each scheduled task creates a new Chrome window + sidepanel popup. The session ID is a random UUID generated at dispatch time (`session_${Date.now()}_${randomString}`). It is unclear how the extension handles the case where the scheduled task sidepanel window is closed by the user before the task completes.

5. **`checkAndRefreshOAuthTokenIfNeeded` in non-SW context:** `Ie()` has a cross-realm path: in non-SW contexts it sends a `check_and_refresh_oauth` message to the SW, which calls `g()` = `Pe()` directly. This keeps OAuth refresh centralised in the SW. Our rebuild using API keys instead of OAuth can ignore this.

6. **`Re()` (getUserId / `p()`):** The bridge WebSocket URL is `wss://bridge.claudeusercontent.com/chrome/{userId}` where `{userId}` = Anthropic account UUID. The UUID is fetched via `/api/oauth/profile`. This means the bridge is account-scoped, not device-scoped. Unclear what happens if two devices use the same account simultaneously.
