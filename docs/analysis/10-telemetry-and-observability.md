# Telemetry and Observability Inventory — Claude in Chrome v1.0.75

> **Scope**: Extension root `/Users/nosferatu/Projects/personal/open-browser-control/.var/1.0.75_0`
> **Purpose**: Complete inventory for building a privacy-first fork with no phone-home.
> **Evidence**: All strings and keys are quoted verbatim from the minified bundles.

---

## (a) Summary

The extension ships **four telemetry integrations** that send data to Anthropic infrastructure and third-party cloud services on every user session:

| # | Service | Category | Active in Chrome Extension? |
|---|---------|----------|-----------------------------|
| 1 | **Segment** (analytics.js v2) | Behavioural event analytics | Yes — key injected from `P()` config |
| 2 | **Sentry** (Browser SDK) | Crash/error reporting | Yes — hardcoded DSN |
| 3 | **Honeycomb** (OTel Web SDK) | Distributed tracing | Yes — hardcoded API key |
| 4 | **Datadog RUM** | Real-user monitoring + logs | Yes — hardcoded application ID |

Additionally the extension uses **GrowthBook** as a client-side feature-flag SDK (bundled, no remote calls in the extension variant), and Segment is configured to fan out to **Amplitude** and **Iterable** server-side.

All four integrations are initialised unconditionally in `sidepanel.html` at boot:
```
O()   // Sentry    — imported as Ro from PermissionManager-BBDx9xIl.js
I()   // Honeycomb — imported as wy from PermissionManager-BBDx9xIl.js
rt()  // Datadog   — imported as B$ from useStorageState-C6Ou-D0H.js
```
Segment is lazy-loaded on first authenticated page view via the `vk` React component.

There is a **FedRAMP/IL5 kill-switch** (`fw = "fedramp" === buildType || "il5" === buildType`) which skips Datadog and Segment in those compliance builds. That constant resolves to `false` in the standard Chrome extension build since `NEXT_PUBLIC_BUILD_TYPE` is undefined at bundle time.

There is also a `disableEssentialTelemetry` / `disableNonessentialTelemetry` flag sourced from `window.desktopEnterpriseConfig` — that object is only set in the Electron desktop app; it is never set in the Chrome extension.

**Trace headers are always injected into every Anthropic API call**: `de = !0` (hardcoded `true`) is passed as `traceHeadersEnabled`, causing `traceparent`, `x-cloud-trace-context`, and `baggage: forceTrace=true` headers to be added to every `POST /v1/messages` request.

---

## (b) Integration Table

| Service | SDK / Library | Network Endpoint | Key / DSN (verbatim) | Toggle? |
|---------|---------------|------------------|-----------------------|---------|
| **Segment** | `@segment/analytics-next` v2 (AnalyticsBrowser) | `https://api.segment.io/v1` (CDN: `cdn.segment.com`) | Write key: **`H7hVDRIBUrlBySLqJ15oAivgqhomdAKT`** (production); dev key: `hNex10EGp3coubOXQI1BIElYaZcA1o0u` — hardcoded in `PermissionManager-BBDx9xIl.js` at offset ~31531 (`x={production:{SEGMENT_WRITE_KEY:"H7hVDRIBUrlBySLqJ15oAivgqhomdAKT"}}`) | GPC signal drops analytics consent; `claude_ai_segment_enabled` feature flag also gates it; FedRAMP flag disables |
| **Sentry** | `@sentry/browser` | `https://60bea3ee4ef1022e4035b23ba50f44d0@o1158394.ingest.us.sentry.io/4509876992278529` | DSN: `https://60bea3ee4ef1022e4035b23ba50f44d0@o1158394.ingest.us.sentry.io/4509876992278529` | No toggle; disabled only when `skipBrowserExtensionCheck` path triggers `enabled: false` |
| **Honeycomb** | `@honeycombio/opentelemetry-web` (OTel) | `https://api.honeycomb.io/v1/traces` | API key: **`hcaik_01k4x5jaf9v7sdymjzmxvktd6whp9x2y75jj8y5f8y7aaf1zy6aedg9858`** | No toggle in extension |
| **Datadog RUM** | `@datadog/browser-rum` | `https://browser-intake-us5-datadoghq.com` (site: `us5.datadoghq.com`) | Application ID: `b33c4cea-db01-4f7f-aede-8f19659e3aff`; Client Token: `pub7cf5a29e0cad4bad0b8e556aa65b7cab` | FedRAMP flag or `disableEssentialTelemetry` (desktop-only env var) |
| **Amplitude** | Via Segment server-side destination (`"Actions Amplitude": true`) | Segment proxy → Amplitude | No client key in bundle | Same as Segment consent |
| **Iterable** | Via Segment server-side destination (`"Iterable": true`) | Segment proxy → Iterable | No client key in bundle | Same as Segment consent |
| **GrowthBook** | `@growthbook/growthbook-react` | No remote calls in extension (no `clientKey` or `apiHost` configured) | None | N/A |

---

## (c) Analytics Event Inventory

### Extension-specific events (tracked directly in sidepanel)

| Event Name | Properties Sent |
|------------|-----------------|
| `claude_chrome.chat.session_started` | `model`, `sessionId`, `permissions` |
| `claude_chrome.chat.user_message_sent` | `model`, `sessionId`, `permissions` |
| `claude_chrome.chat.assistant_response_stopped` | `model`, `cancelled`, `sessionId`, `permissions`, `stopReason` |
| `claude_chrome.chat.feedback` | feedback fields, `sessionId`, `permissions.permissionMode` |
| `claude_chrome.chat.tool_called` | `name` (tool name), `sessionId`, `permissions`, `success`, `failureReason`, `action` (for computer tool), `sub_action_count`, `sub_actions` (for batch), `domain`, `app` |
| `claude_chrome.chat.usage` | `usage` (token counts from API response), `sessionId`, `permissions` |
| `claude_chrome.chat.shortcut_created` | `sessionId`, `commandName` |
| `claude_chrome.chat.shortcut_deleted` | `sessionId`, `commandName`, `oldCommandName` |
| `claude_chrome.chat.shortcut_updated` | `sessionId`, `commandName`, `oldCommandName` |
| `claude_chrome.chat.system_command_executed` | `sessionId`, `commandName`, `commandType` (`shortcut` or `system`) |
| `claude_chrome.permission_mode.changed` | `from`, `to`, `method` (`menu` or `keyboard_shortcut`) |
| `claude_chrome.chat.${e}_compact` | (template literal — compact view variant) |
| `spotlight.shown` | (no custom properties observed) |
| `spotlight.dismissed` | (no custom properties observed) |
| `spotlight.action_clicked` | (no custom properties observed) |
| `page_viewed` | URL path, referrer |
| `$identify` | account UUID, organization UUID, anonymous ID, traits |
| `Segment Consent Preference` | consent categories |

### All events in schema registry (1671 total — full platform schema, not all fired by extension)

The schema object embedded in `sidepanel-BL0NRfq2.js` contains 1671 registered event names. Key groups relevant to the extension build:

- `cc_celebration.*` — onboarding/celebration flow (13 events: `shown`, `dismissed`, `cta_clicked`, `game_*`, etc.)
- `spotlight.*` — feature spotlight (3 events)
- `login.*` / `landing.*` — web login flow events (loaded from `claude.ai` web bundle)
- `claudeai.*` — core Claude.ai web app events (cowork, code sessions, model switching, upsells, etc.)
- `billing.*` — upgrade/payment events
- `artifact.*` — artifact interaction events

**All 17 extension-specific events** are the ones starting with `claude_chrome.*` plus `spotlight.*`.

### Properties that can contain sensitive data

- `sessionId` — pseudonymous session UUID (not user-identifying by itself)
- `permissions` — permission mode string (e.g. `"skip_all_permission_checks"`)
- `model` — model name selected
- `domain` — domain of the page the tool was called on (URL hostname)
- `app` — detected app name from URL
- `sub_actions` — array of sub-action type strings for batch computer tool calls
- `usage` — token counts from the Anthropic response (input tokens, output tokens, cache stats)
- `commandName` — slash-command name (not message content)

**Message content is NOT tracked.** The `user_message_sent` event carries only `{model, sessionId, permissions}`.

---

## (d) Sentry / Crash Reporting Details

**DSN**: `https://60bea3ee4ef1022e4035b23ba50f44d0@o1158394.ingest.us.sentry.io/4509876992278529`

**Init function** (`Ro()` in `PermissionManager-BBDx9xIl.js`):
```js
// Stripped integrations: BrowserApiErrors, Breadcrumbs, GlobalHandlers (removed to reduce noise in extension)
{
  dsn: "https://60bea3ee4ef1022e4035b23ba50f44d0@o1158394.ingest.us.sentry.io/4509876992278529",
  transport: so,           // custom fetch transport
  stackParser: fo,
  integrations: [...filtered],
  initialScope: {
    tags: { extension_version: chrome.runtime.getManifest().version }
  },
  beforeSend: t => ({
    ...t,
    contexts: {
      ...t.contexts,
      extension: {
        id: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        environment: "production"
      }
    }
  })
}
```

**`captureException` call sites** (4 in `PermissionManager-BBDx9xIl.js`, 2 in `sidepanel-BL0NRfq2.js`):
- Scope-level capture (internal SDK path)
- Hub-level capture with event ID
- Internal pipeline error handler: `captureException(t, {mechanism:{handled:false, type:"internal"}})`
- Re-wrapped exception handler

**`addBreadcrumb`**: 2 call sites — both are internal SDK breadcrumb buffer management (max 100 breadcrumbs, message truncated at 2048 chars).

**PII scrubbing**: The `beforeSend` hook does NOT explicitly scrub PII — it only adds extension context. Stack traces and error messages are sent as-is.

**What can appear in Sentry events**: exception class and message, stack trace (with extension source file names/line numbers), extension ID and version, Chrome runtime info. If an error is thrown while handling user input, the exception message could leak content depending on error text.

---

## (e) Tracing (Honeycomb / OTel) and RUM (Datadog) Details

### Honeycomb

**Init function** (`wy()` in `PermissionManager-BBDx9xIl.js`):
```js
new HoneycombWebSDK({
  debug: false,  // true only if environment !== "production"
  apiKey: "hcaik_01k4x5jaf9v7sdymjzmxvktd6whp9x2y75jj8y5f8y7aaf1zy6aedg9858",
  serviceName: "claude-browser-extension",
  sampleRate: 1,    // 100% sampling — ALL traces sent
  resourceAttributes: {
    "extension.version": chrome.runtime.getManifest().version,
    "build.type": "external"
  },
  webVitalsInstrumentationConfig: { enabled: false }
}).start()
```

**Span attribute fields** (set via `i.setAttribute(...)` in `sidepanel-BL0NRfq2.js`):
- `session_id` — chat session UUID
- `permissions` — permission mode
- `tool_name` — name of tool being executed
- `action` — tool action (e.g. computer mouse action)
- `success` / `failure_reason` — tool execution result
- `account_uuid` — user's Anthropic account UUID (**PII — user identifier**)
- `model` — selected model
- `sampling_trace_id` — trace correlation ID

**Trace headers injected into Anthropic API** (always enabled, `de = true`):
```
traceparent: 00-{32-hex-traceId}-{16-hex-spanId}-01
x-cloud-trace-context: {traceId}/{decimal spanId};o=1
baggage: forceTrace=true
x-refinery-force-trace: true
```
These are generated by `by()` in `PermissionManager-BBDx9xIl.js` and sent with every `POST /v1/messages` call. The `forceTrace=true` baggage ensures Anthropic's backend also traces the request end-to-end.

**Auto-instrumentation**: Web Vitals are disabled (`webVitalsInstrumentationConfig: {enabled: false}`). The OTel SDK auto-instruments XHR/Fetch by default, which means every network request from the extension will generate a span exported to Honeycomb.

### Datadog RUM

**Init call** (`B$()` in `useStorageState-C6Ou-D0H.js`):
```js
M$.init({
  applicationId: "b33c4cea-db01-4f7f-aede-8f19659e3aff",
  clientToken: "pub7cf5a29e0cad4bad0b8e556aa65b7cab",
  site: "us5.datadoghq.com",
  service: "claude-for-chrome",
  env: "production",
  version: chrome.runtime.getManifest().version,
  sessionSampleRate: 100,         // ALL sessions sampled
  sessionReplaySampleRate: 0,     // Session replay disabled
  allowedTracingUrls: [
    /^https:\/\/anthropic\.com/,
    /^https:\/\/[^/]*\.anthropic\.com/
  ],
  defaultPrivacyLevel: "mask-user-input",  // Input fields masked
  trackUserInteractions: false,
  enablePrivacyForActionName: true,
  plugins: [...]
})
```

**`beforeSend` filter** (`x_()` in `sidepanel-BL0NRfq2.js`): Sanitises URL path segments — replaces UUIDs and long tokens with `{id}` or `/unknown`. Scrubs `url` and `referrer` fields. Does NOT strip the domain name.

**RUM API calls observed**:
- `ve.addAction(name, attrs)` — wraps analytics actions
- `ve.addError(err, context)` — wraps caught errors
- `ve.addTiming(name, duration)` — performance timing
- `ve.getUser()` — user identity read at flush

**PII**: Datadog receives the URL path (sanitised), error messages, and session-level metrics. `defaultPrivacyLevel: "mask-user-input"` masks form inputs. Account UUID is set as a span attribute in OTel traces that Datadog can see via `allowedTracingUrls`.

---

## (f) Feature Flags / Remote Config

### GrowthBook

`@growthbook/growthbook-react` is bundled in `useStorageState-C6Ou-D0H.js` and instantiated with **no options**:
```js
_k = new GrowthBook({})
```

No `clientKey`, no `apiHost`, no `streamingHost` → **no remote feature-flag fetches occur** in the Chrome extension. Features must be injected server-side via the `oi` (GrowthBook Provider) component receiving features from the authenticated claude.ai session.

The flags observed in `sidepanel-BL0NRfq2.js`:
- `claude_ai_segment_enabled` — gates Segment loading
- `log_segment_events` — enables console logging of Segment events
- `claudeai_antalytics_dual_fire` — sends events to a secondary analytics endpoint

### Consent Management

- `requiresExplicitConsent` — server-provided flag (EU/UK users)
- GPC (Global Privacy Control) signal detected from browser: if `gpcDetected`, analytics and marketing consent default to `false`
- Consent stored in cookie key `xe.CONSENT_PREFERENCES`
- Default with no stored preference and `requiresExplicitConsent=false`: `{analytics: true, marketing: true}` (opt-in by default)
- FedRAMP/IL5 build: analytics object replaced with a no-op stub

---

## (g) STRIP-LIST — Actionable Removal Guide

### Strategy: No-op all telemetry at the init seam

The cleanest approach is to stub the three init calls at startup and no-op the Segment load. This requires modifying `sidepanel-BL0NRfq2.js` (or, preferably, rebuilding from source with the following changes).

---

### 1. Sentry — Remove or no-op `Ro()` / `O()`

**File**: `assets/PermissionManager-BBDx9xIl.js`
**Seam**: Function `Ro` (exported as `i`, imported as `O` in sidepanel)
**Action**: Replace the body of `Ro` with a no-op:
```js
const Ro = () => {};
```
**Also remove**: The Sentry SDK bulk (everything depending on `dsn:`, `captureException`, `addBreadcrumb`, `Yi(Hs,n)`, etc.). This is 80–100 KB of the PermissionManager bundle.
**User-facing impact**: None. Errors still appear in the console. You lose crash telemetry.

---

### 2. Honeycomb — Remove or no-op `wy()` / `I()`

**File**: `assets/PermissionManager-BBDx9xIl.js`
**Seam**: Function `wy` (exported as `o`, imported as `I` in sidepanel)
**Action**: Replace body with a no-op:
```js
function wy() {}
```
**Also remove**:
- The `by()` function (`by` in PermissionManager) which generates `traceparent` / `forceTrace` headers.
- All usages of `S(l)` in the `createAnthropicMessage` function in `sidepanel-BL0NRfq2.js` (the `{traceId, headers} = S(l)` call). Replace `{headers: h}` passed to `t.beta.messages.*` with `{}`.
- The OTel SDK bundle (Batchprocessors, exporters, `_y`, span infrastructure) — large.

**User-facing impact**: None. Tool call spans and performance data are no longer sent to Honeycomb. Anthropic API requests no longer carry `forceTrace` baggage (may slightly reduce Anthropic-side observability of your fork's traffic).

---

### 3. Datadog RUM — Remove or no-op `B$()` / `rt()`

**File**: `assets/useStorageState-C6Ou-D0H.js`
**Seam**: Function `B$` (exported as `av`, imported as `rt` in sidepanel)
**Action**: Replace with a no-op:
```js
function B$() {}
```
**Also no-op** the `ve` object (currently the Datadog RUM singleton, exported as `c7` from `useStorageState`). Replace with a stub that satisfies all call sites:
```js
const ve = {
  init(){}, getUser(){return null}, addAction(){}, addError(){},
  addTiming(){}, setUser(){}, getSessionReplayLink(){return null}
};
```
**User-facing impact**: None. RUM performance/error data no longer sent to Datadog.

---

### 4. Segment — Prevent load

**File**: `assets/useStorageState-C6Ou-D0H.js` (extension Segment loader) and `assets/sidepanel-BL0NRfq2.js` (web Segment loader)

**Extension loader seam** (`vk` component in `useStorageState-C6Ou-D0H.js`):
```js
// Replace the async init to always return null analytics:
mk = (async () => ({ analytics: null }))()
```

**Web loader seam** (`a_` in `sidepanel-BL0NRfq2.js`):
```js
// Replace with the no-op stub that is already present in the code for fw=true builds:
a_ = new class {
  constructor() {
    this.loadIfNecessary = () => null;
    this.registerOnConsentChanged = () => {};
    this.getCategories = () => ({ analytics: false, marketing: false, necessary: true });
    this.updateCategories = () => {};
    this.reset = () => {};
    this.flush = () => Promise.resolve();
    this.anonymousId = "";
  }
}()
```

**Also remove** from `sidepanel-BL0NRfq2.js`:
- The `kc` (AnalyticsBrowser) SDK (~50 KB)
- The Amplitude session-ID plugin (`n_`, `s_`)
- The `wrapAnalyticsWithConsent` consent management wrapper

**User-facing impact**: None.

---

### 5. Remove Segment write key constant

**File**: `assets/PermissionManager-BBDx9xIl.js`
**Seam**: `const x = {production:{SEGMENT_WRITE_KEY:"H7hVDRIBUrlBySLqJ15oAivgqhomdAKT"}, development:{...}}`
**Action**: Delete or replace with `const x = {production:{SEGMENT_WRITE_KEY:""}, development:{SEGMENT_WRITE_KEY:""}}`.

---

### 6. Remove Honeycomb API key constant

**File**: `assets/PermissionManager-BBDx9xIl.js`
**Seam**: `apiKey:"hcaik_01k4x5jaf9v7sdymjzmxvktd6whp9x2y75jj8y5f8y7aaf1zy6aedg9858"`
**Action**: Delete string or replace with empty string (the `wy()` no-op in step 2 makes this irrelevant, but belt-and-suspenders).

---

### 7. Remove Datadog credentials

**File**: `assets/useStorageState-C6Ou-D0H.js`
**Seam**: `applicationId:"b33c4cea-db01-4f7f-aede-8f19659e3aff",clientToken:"pub7cf5a29e0cad4bad0b8e556aa65b7cab"`
**Action**: Delete or replace with empty strings.

---

### 8. Update manifest CSP

**File**: `manifest.json`
**Action**: Remove from `connect-src`:
```
https://api.segment.io https://*.segment.com
https://*.ingest.us.sentry.io
https://api.honeycomb.io
https://browser-intake-us5-datadoghq.com
```

---

### Summary of files requiring changes

| File | What to change |
|------|---------------|
| `manifest.json` | Remove 4 telemetry origins from `connect-src` |
| `assets/PermissionManager-BBDx9xIl.js` | No-op `Ro()` (Sentry init), no-op `wy()` + `by()` (Honeycomb init + trace header generator), remove `x.SEGMENT_WRITE_KEY` constant |
| `assets/useStorageState-C6Ou-D0H.js` | No-op `B$()` (Datadog init), stub `M$`/`ve` Datadog object, stub `vk`/`mk` Segment loader, remove Datadog credentials |
| `assets/sidepanel-BL0NRfq2.js` | Stub `a_` Segment analytics object, remove `S(l)` trace-header injection from `createAnthropicMessage`, remove Amplitude session-ID plugin |

---

## (h) Privacy Observations — What PII Leaves the Browser

| Data | Destination | Sent when |
|------|-------------|-----------|
| **Anthropic account UUID** (`account_uuid`) | Honeycomb (OTel span attribute) | Every Anthropic API call |
| **Anthropic account UUID** | Segment (`$identify` event, `account_uuid` property) | On login |
| **Organization UUID** | Segment (`$identify`) | On login |
| **Anonymous ID** (pseudonymous, UUID, persisted in chrome.storage) | Segment, Datadog | Every session |
| **Permission mode** | Segment (all `claude_chrome.*` events), Honeycomb (span attribute) | Every tool call, message |
| **Model name** | Segment, Honeycomb | Every message |
| **Session UUID** | Segment, Honeycomb | Every event |
| **Tool name** | Segment (`tool_called`), Honeycomb (span attribute) | Every tool execution |
| **Domain of active page** | Segment (`claude_chrome.chat.tool_called` → `domain` field) | When tool is called on a page |
| **Token usage counts** | Segment (`claude_chrome.chat.usage`) | After each model response |
| **Command name** (slash-command) | Segment | When slash-command used |
| **Trace ID** + W3C traceparent | Anthropic API (as HTTP header) | Every API call (always) |
| **URL path** (sanitised) | Datadog RUM (`view.name`) | Every page/view navigation |
| **JavaScript errors** (stack traces) | Sentry | On uncaught exception |
| **Extension ID + version** | Sentry (scope tag) | On uncaught exception |

**What is NOT sent**:
- Message text content (user input or assistant responses)
- Conversation history
- Page titles or page body content
- Clipboard contents
- Screenshots or images processed by the computer tool
- Email address (only UUID is sent via identify, not the email string)

---

## (i) Open Questions

1. **`claude_ai_segment_enabled` feature flag source**: This flag is checked before loading Segment. It appears to come from a GrowthBook feature payload injected by the `claude.ai` web app. In the Chrome extension context (not embedded in claude.ai), this flag's value is unclear — if GrowthBook has no features, it defaults to `false`, which would prevent Segment from loading entirely. **Verify** whether Segment ever fires in a fresh extension install without a claude.ai tab open.

2. **Segment write key origin in extension**: In the Chrome extension path (`useStorageState-C6Ou-D0H.js`), Segment is loaded via `n.segmentWriteKey` where `n = T()` = `P()` from `PermissionManager`. `P()` returns `x["production"].SEGMENT_WRITE_KEY` = `"H7hVDRIBUrlBySLqJ15oAivgqhomdAKT"`. However the `vk` analytics provider is inside a `React.Suspense` boundary and only renders when `!A()` (where `A()` checks if the extension is running in a specific mode). Confirm at runtime whether the extension Segment instance actually fires in normal use.

3. **Anthropic server-side trace retention**: The `forceTrace=true` baggage forces Anthropic's backend to retain full traces. The privacy implications depend on what Anthropic stores server-side for traced requests. This is outside the bundle but worth documenting for the open-source fork.

4. **Datadog session identity**: `ve.getUser()` is called at `pagehide` to attach the user to the final flush batch (line containing `S_.length`, `ve.getUser()`). Confirm whether the Datadog user identity is ever explicitly set with account UUID in the extension flow.

5. **`auto-track-lqE0fk0a.js`**: This auto-track module (trackLink / trackForm) is dynamically imported. Confirm whether any links or forms in the sidepanel HTML actually trigger it, since the sidepanel is a single-page React app with no traditional HTML forms.
