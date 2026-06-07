# 07 — Storage and State Schema

## (a) Summary

The extension persists all state in **`chrome.storage.local`** only. No `chrome.storage.session`, no `chrome.storage.sync`, and no IndexedDB are used despite the manifest declaring `unlimitedStorage`. `chrome.storage.managed` is read-only (set by enterprise MDM) and holds two keys.

**32 distinct storage keys** were found across the codebase (31 in `chrome.storage.local` + 2 `chrome.storage.managed` + 1 ephemeral `mcp_prompt_<requestId>` family). The keys are declared as a single TypeScript enum (`StorageKey`) defined in `PermissionManager-BBDx9xIl.js` and imported by every bundle.

**No IndexedDB, no `chrome.storage.session`, no `sessionStorage` for persistent data.** `sessionStorage` is used transiently for two runtime-only keys (`currentScheduledTaskRunId`, `currentScheduledTaskName`) that are written by the service worker before opening a scheduled-task sidepanel window and removed when the task ends.

**All data is stored unencrypted** in plain JSON (see §f).

---

## (b) Master Key Table

### `chrome.storage.managed` (read-only, set by MDM)

| Key | Shape | Purpose | Writer/Reader |
|-----|-------|---------|--------------|
| `blockedUrlPatterns` | `string[]` | URL hostname/path patterns where the extension is blocked | `managed_schema.json` (MDM writes); `mcpPermissions-8PlHLvdl.js` reads |
| `forceLoginOrgUUID` | `string` (single UUID or JSON-encoded `string[]`) | Restricts which Anthropic org(s) may use the extension | `managed_schema.json` (MDM writes); `useStorageState-C6Ou-D0H.js` reads |

### `chrome.storage.local`

| Key | Shape | Purpose | Writer | Reader |
|-----|-------|---------|--------|--------|
| `accessToken` | `string` (OAuth Bearer JWT) | Anthropic OAuth access token | `PermissionManager-BBDx9xIl.js` `storeTokens()` | `PermissionManager-BBDx9xIl.js`, `sidepanel-BL0NRfq2.js` |
| `refreshToken` | `string` (OAuth refresh token) | Used to silently obtain a new `accessToken` | `PermissionManager-BBDx9xIl.js` `storeTokens()` | `PermissionManager-BBDx9xIl.js` |
| `tokenExpiry` | `number` (Unix ms timestamp) | Expiry timestamp for `accessToken` | `PermissionManager-BBDx9xIl.js` `storeTokens()` | `PermissionManager-BBDx9xIl.js` |
| `oauthState` | `string` (PKCE state nonce) | CSRF state during OAuth flow | `PermissionManager-BBDx9xIl.js` `initiateOAuthFlow()` | `PermissionManager-BBDx9xIl.js` `handleOAuthRedirect()` |
| `codeVerifier` | `string` (PKCE verifier) | PKCE code verifier during OAuth | `PermissionManager-BBDx9xIl.js` `initiateOAuthFlow()` | `PermissionManager-BBDx9xIl.js` `handleOAuthRedirect()` |
| `lastAuthFailureReason` | `string` (`"session_expired"` \| others) | Why the last auth attempt failed | `PermissionManager-BBDx9xIl.js` | `sidepanel-BL0NRfq2.js` |
| `accountUuid` | `string` (UUID) | Authenticated user's account UUID fetched from `/api/oauth/profile` | `PermissionManager-BBDx9xIl.js` `handleOAuthRedirect()` | `PermissionManager-BBDx9xIl.js` |
| `anthropicApiKey` | `string` (raw API key) | Alternative auth via direct API key (non-OAuth mode) | `mcpPermissions-8PlHLvdl.js` (MCP bridge pairing); `options-DxcKhBKM.js` settings | `PermissionManager-BBDx9xIl.js`, `mcpPermissions-8PlHLvdl.js`, `sidepanel-BL0NRfq2.js` |
| `selectedModel` | `string` (model ID, e.g. `"claude-sonnet-4-5-20250929"`) | User's sticky model choice; null = use default | `sidepanel-BL0NRfq2.js` `setStickyModel()` | `sidepanel-BL0NRfq2.js` |
| `systemPrompt` | `string` (free text) | Developer-override system prompt injected into every conversation | Developer/internal settings | `sidepanel-BL0NRfq2.js` (prepended to system prompt array) |
| `debugMode` | `boolean` | Show debug metadata on tool-call blocks | Developer/internal settings | `sidepanel-BL0NRfq2.js` |
| `modelSelectorDebug` | `boolean` | Show model selector debug info | Developer/internal settings | `sidepanel-BL0NRfq2.js` (inferred) |
| `showTraceIds` | `boolean` | Show request/trace IDs in the UI | Developer/internal settings | `sidepanel-BL0NRfq2.js` |
| `showSystemReminders` | `boolean` | Show system reminder text in message bubbles | Developer/internal settings | `sidepanel-BL0NRfq2.js` |
| `perfTracePill` | `boolean` | Show performance trace pill | Developer/internal settings | `sidepanel-BL0NRfq2.js` (inferred) |
| `useSessionsAPI` | `boolean` | Feature flag override: use Claude Sessions API | Developer/internal settings | `sidepanel-BL0NRfq2.js` (inferred) |
| `sessionsApiHostname` | `string` | Override hostname for Sessions API | Developer/internal settings | `sidepanel-BL0NRfq2.js` (inferred) |
| `browserControlPermissionAccepted` | `boolean` | First-run gate: user has acknowledged browser control permission | `sidepanel-BL0NRfq2.js` (on accept click) | `sidepanel-BL0NRfq2.js` |
| `permissionStorage` | `{ permissions: Permission[] }` (see §c) | Persisted per-domain/per-tool allow/deny rules | `PermissionManager-BBDx9xIl.js` `savePermissions()` | `PermissionManager-BBDx9xIl.js` `loadPermissions()` |
| `lastPermissionModePreference` | `string` (`"skip_all_permission_checks"` \| `"ask"` \| `"follow_a_plan"` \| other) | Last chosen permission mode; restored on sidepanel open | `sidepanel-BL0NRfq2.js` | `sidepanel-BL0NRfq2.js` |
| `anonymousId` | `string` (UUID) | Analytics anonymous ID; **survives logout** | First creation (auto-generated) | Analytics (Segment) tracking |
| `test_data_messages` | `Message[]` (chat message array) | Dev-mode pre-loaded test conversation | Developer/internal settings | `sidepanel-BL0NRfq2.js` (loaded on 100 ms delay if present) |
| `scheduledTaskLogs` | `TaskRunLog[]` (max 500 entries, pruned >30 days) — see §c | Execution history for scheduled tasks | `sidepanel-BL0NRfq2.js` `H5.saveLogs()` | `sidepanel-BL0NRfq2.js` `H5.getAllLogs()` |
| `scheduledTaskStats` | `{ [taskId: string]: TaskStats }` — see §c | Per-task aggregate stats | `sidepanel-BL0NRfq2.js` `H5.updateStats()` | `sidepanel-BL0NRfq2.js` `H5.getTaskStats()` |
| `pendingScheduledTask` | `SavedPrompt` (partial; prompt to open in options) | Transient handoff from sidepanel→options for new scheduled task creation | `sidepanel-BL0NRfq2.js`; `service-worker.ts-BsAUV92e.js` | `options-DxcKhBKM.js` (then immediately removed) |
| `targetTabId` | `number` (Chrome tab ID) | Tab used by the current scheduled-task window | `service-worker.ts-BsAUV92e.js` | `mcpPermissions-8PlHLvdl.js` |
| `updateAvailable` | `boolean` | New extension version is available; **survives logout** | `service-worker.ts-BsAUV92e.js` `chrome.runtime.onUpdateAvailable` | `sidepanel-BL0NRfq2.js` |
| `tipDisplayCounts` | `{ [tipKey: string]: string[] }` — tipKey → array of session IDs where tip was shown | Limits how many times a UI tip is shown (e.g. `pin_extension` max 1 display) | `sidepanel-BL0NRfq2.js` | `sidepanel-BL0NRfq2.js` |
| `notificationsEnabled` | `boolean \| undefined` | Whether browser notifications are enabled for scheduled tasks | `options-DxcKhBKM.js` (permissions tab toggle) | `sidepanel-BL0NRfq2.js`, `options-DxcKhBKM.js` |
| `announcementDismissed` | `string` (announcement ID / empty) | ID of the last dismissed announcement banner | `sidepanel-BL0NRfq2.js` | `sidepanel-BL0NRfq2.js` |
| `modelOverrideSeen` | `string` (model override UUID from feature flag) | Tracks which model override has been surfaced to the user | `sidepanel-BL0NRfq2.js` | `sidepanel-BL0NRfq2.js` |
| `savedPrompts` | `SavedPrompt[]` — see §c | Library of user-saved prompt shortcuts (may have alarm schedules) | `PermissionManager-BBDx9xIl.js` `Ey.savePrompt()` / `updatePrompt()` | `PermissionManager-BBDx9xIl.js`, `service-worker.ts-BsAUV92e.js` |
| `savedPromptCategories` | `string[]` (category names) | User-defined categories for saved prompts | `options-DxcKhBKM.js` | `options-DxcKhBKM.js` |
| `tabGroups` | `{ [mainTabId: string]: TabGroupMeta }` — see §c | Tracks which Chrome tab groups are managed by the extension | `mcpPermissions-8PlHLvdl.js` `W.saveToStorage()` | `mcpPermissions-8PlHLvdl.js` `W.loadFromStorage()` |
| `dismissedTabGroups` | `number[]` (Chrome tab group IDs) | Groups whose static indicators the user has dismissed | `mcpPermissions-8PlHLvdl.js` | `mcpPermissions-8PlHLvdl.js` |
| `mcpTabGroupId` | `number` (Chrome tab group ID) | Which tab group belongs to the connected MCP session | `mcpPermissions-8PlHLvdl.js` | `mcpPermissions-8PlHLvdl.js` |
| `mcpConnected` | `boolean` | Whether the native-messaging MCP host is currently connected | `service-worker.ts-BsAUV92e.js` | `mcpPermissions-8PlHLvdl.js` |
| `features` | `{ payload: { features: Record<string,any> }, timestamp: number }` | Remote feature flag cache (TTL 5 min = 300 000 ms) | `PermissionManager-BBDx9xIl.js` `D.saveToCache()` | `PermissionManager-BBDx9xIl.js` `D.loadFromCache()` |
| `preferred_locale` | `string` (BCP 47 locale code, e.g. `"en-US"`) | UI locale preference | `index-Bh2gA_fy.js` `Ln.setLocale()` | `index-Bh2gA_fy.js` `Ln()` hook |
| `cicStripExtensionInterference` | `boolean` (default `true`) | Kill-switch: when `false`, disables the "strip extension interference" content-script injections | Manual/DevTools write | `mcpPermissions-8PlHLvdl.js` `P()` |
| `captureScreenshotClipScale` | `boolean` (default `false`) | Whether screenshots are clipped at the visible viewport scale | Manual/DevTools write | `mcpPermissions-8PlHLvdl.js` `X()` |
| `bridgeDeviceId` | `string` (UUID) | Stable device identifier for the MCP/pairing bridge | `mcpPermissions-8PlHLvdl.js` `un()` (auto-generated if absent) | `mcpPermissions-8PlHLvdl.js` |
| `bridgeDisplayName` | `string` | Human-readable device name set during MCP pairing | `mcpPermissions-8PlHLvdl.js` (on `pairing_confirmed`) | `mcpPermissions-8PlHLvdl.js` |
| `mcp_prompt_<requestId>` | `{ prompt: PermissionPrompt, tabId: number, timestamp: number }` | Transient permission-prompt handoff from background→sidepanel permission window | `mcpPermissions-8PlHLvdl.js` | `sidepanel-BL0NRfq2.js`, `mcpPermissions-8PlHLvdl.js` (removed on response) |

### `sessionStorage` (ephemeral, per-tab, not persisted)

| Key | Shape | Purpose |
|-----|-------|---------|
| `currentScheduledTaskRunId` | `string` | Active task run log ID for in-progress scheduled task |
| `currentScheduledTaskName` | `string` | Display name of in-progress scheduled task |

---

## (c) Reconstructed Data-Model Types

### Auth / Identity

```ts
// chrome.storage.local keys: accessToken, refreshToken, tokenExpiry, oauthState, codeVerifier
// Written together by storeTokens():
interface StoredTokens {
  accessToken: string;      // Bearer JWT
  refreshToken: string;     // OAuth refresh token
  tokenExpiry: number;      // Unix ms; access token expires at this timestamp
  oauthState: string;       // PKCE state nonce (written at flow start, read+cleared at redirect)
}
// codeVerifier: string — PKCE verifier (written at flow start, read+cleared at redirect)
// lastAuthFailureReason: "session_expired" | string — set when token invalid
// accountUuid: string — Anthropic account UUID from /api/oauth/profile
// anthropicApiKey: string — optional direct API key (non-OAuth path)
// anonymousId: string — UUID for analytics; NOT cleared on logout
```

### Permission Store

```ts
// chrome.storage.local key: permissionStorage
interface PermissionStore {
  permissions: Permission[];
}

type PermissionScope =
  | { type: "netloc"; netloc: string }           // hostname match
  | { type: "domain_transition"; fromDomain: string; toDomain: string }
  | { type: string };                             // forward-compat: navigate, click, type, etc.

interface Permission {
  id: string;                         // crypto.randomUUID()
  scope: PermissionScope;
  action: "allow" | "deny";
  duration: "once" | "always";
  createdAt: number;                  // Unix ms
  lastUsed?: number;                  // Unix ms, updated on each check
  toolUseId?: string;                 // present only for duration==="once"
}

// chrome.storage.local key: lastPermissionModePreference
type PermissionMode = "skip_all_permission_checks" | "ask" | "follow_a_plan";
```

### Saved Prompts / Shortcuts

```ts
// chrome.storage.local key: savedPrompts
interface SavedPrompt {
  id: string;                         // "prompt_<timestamp>"
  prompt: string;                     // The prompt text
  command?: string;                   // Slash command shortcut (e.g. "summarize")
  url?: string;                       // Target URL for scheduled execution
  enabled: boolean;
  skipPermissions?: boolean;
  model?: string;                     // Override model for scheduled runs
  createdAt: number;
  usageCount: number;
  lastUsedAt?: number;
  // Scheduling fields (all optional; absent = not scheduled):
  repeatType?: "none" | "once" | "daily" | "weekly" | "monthly" | "annually";
  specificTime?: string;              // "HH:MM" 24-hour
  specificDate?: string;              // "YYYY-MM-DD" for repeatType==="once"
  dayOfWeek?: number;                 // 0=Sun for repeatType==="weekly"
  dayOfMonth?: number;                // 1-31 for repeatType==="monthly"
  monthAndDay?: string;               // "M-D" for repeatType==="annually"
  nextRun?: number;                   // Unix ms; synced from chrome.alarms
}

// chrome.storage.local key: savedPromptCategories
type SavedPromptCategories = string[];
```

### Scheduled Task Logs

```ts
// chrome.storage.local key: scheduledTaskLogs
// Max 500 entries total; max 50 per taskId; pruned >30 days
interface TaskRunLog {
  id: string;                         // "<taskId>_<timestamp>"
  taskId: string;                     // Matches SavedPrompt.id
  taskName: string;
  timestamp: number;                  // Unix ms, start time
  status: "started" | "completed" | "failed";
  prompt: string;
  url?: string;
  duration?: number;                  // ms, set on completion/failure
  error?: string;
  messages: TaskLogMessage[];
}

interface TaskLogMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

// chrome.storage.local key: scheduledTaskStats
interface ScheduledTaskStats {
  [taskId: string]: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageDuration: number;          // ms
    lastRunDate: number;              // Unix ms
  };
}
```

### Tab Groups (MCP UI tracking)

```ts
// chrome.storage.local key: tabGroups
interface TabGroupStore {
  [mainTabId: string]: {
    mainTabId: number;
    createdAt: number;
    domain: string;
    chromeGroupId: number;
    memberStates: {
      [tabId: string]: {
        indicatorState: "none" | "static" | "pulsing";
      };
    };
  };
}

// chrome.storage.local key: dismissedTabGroups — number[] of Chrome tab group IDs
// chrome.storage.local key: mcpTabGroupId — number, the MCP session's tab group
// chrome.storage.local key: mcpConnected — boolean
```

### Features Cache

```ts
// chrome.storage.local key: features (default storageKey; TTL 300 000 ms)
interface FeaturesCache {
  payload: {
    features: Record<string, unknown>;   // remote feature-flag values
  };
  timestamp: number;                      // Unix ms when cached
}
```

### UI/Display State

```ts
// Simple booleans / strings — no complex shapes:
// tipDisplayCounts: { [tipKey: string]: string[] }  (sessions where tip was shown)
// notificationsEnabled: boolean | undefined
// announcementDismissed: string (announcement ID or "")
// modelOverrideSeen: string (model override UUID from feature flag)
// browserControlPermissionAccepted: boolean
// selectedModel: string | null
// updateAvailable: boolean

// tipDisplayCounts structure:
interface TipDisplayCounts {
  pin_extension?: string[];    // Array of tabId strings where tip was shown; max 1 display
  // future tips...
}
```

### Bridge / MCP Pairing

```ts
// chrome.storage.local keys: bridgeDeviceId, bridgeDisplayName
interface BridgeIdentity {
  bridgeDeviceId: string;      // crypto.randomUUID(), generated on first access
  bridgeDisplayName: string;   // Set on pairing_confirmed message from bridge
}

// mcp_prompt_<requestId>:
interface McpPermissionPrompt {
  prompt: PermissionPrompt;    // see PermissionScope types
  tabId: number;
  timestamp: number;
}
```

### Developer / Internal Settings (written only via DevTools or internal build)

```ts
// All booleans or strings; default undefined/false in production:
// debugMode: boolean
// modelSelectorDebug: boolean
// showTraceIds: boolean
// showSystemReminders: boolean
// perfTracePill: boolean
// useSessionsAPI: boolean
// sessionsApiHostname: string
// systemPrompt: string  (free-text developer system prompt)
// test_data_messages: Message[]  (pre-loaded test conversation)
// cicStripExtensionInterference: boolean (kill-switch; default true)
// captureScreenshotClipScale: boolean (default false)
```

---

## (d) IndexedDB / Large-Storage Usage

**No IndexedDB is used.** Despite the manifest declaring `unlimitedStorage`, all data resides in `chrome.storage.local`. The `unlimitedStorage` permission is likely declared to avoid hitting the default 10 MB `chrome.storage.local` quota, since scheduled task logs can accumulate (up to 500 entries × potentially large message arrays).

Retention limits implemented in code:
- `scheduledTaskLogs`: pruned to max 500 entries total; max 50 per task; older than 30 days removed.
- `features` cache: TTL 5 minutes.
- No explicit limit on `savedPrompts`, `permissionStorage`, or `tabGroups`.

---

## (e) Schema Versioning / Migration Logic

**No explicit schema version or migration system was found.**

- The `Z()` function (`clearAuthTokenAndLocalStorage`) wipes all keys from the `StorageKey` enum **except** `anonymousId` and `updateAvailable` on logout. This acts as a soft migration by clearing stale data.
- The extension clears `updateAvailable` on `chrome.runtime.onInstalled` (every update).
- The `PKCE`/OAuth keys (`oauthState`, `codeVerifier`) are written atomically together and cleared on redirect handling.
- No `storageVersion` key or migration runner was identified. Schema changes across extension versions rely on the JS code being tolerant of `undefined` values (all reads use `|| []`, `|| {}`, `|| false` etc.).

---

## (f) Security Observations

1. **OAuth tokens stored in plaintext.** `accessToken` and `refreshToken` are stored as plain strings in `chrome.storage.local` with no encryption. Any extension with `storage` permission or any process that can read the Chrome profile directory can extract them.

2. **Anthropic API key in plaintext.** `anthropicApiKey` is stored as a plain string — readable by DevTools or any script with storage access.

3. **PKCE verifier transiently in storage.** `codeVerifier` and `oauthState` are written to `chrome.storage.local` during the OAuth flow and removed after redirect. Short-lived, but window exists.

4. **No token encryption at rest.** This is standard for browser extensions using `chrome.storage.local`; Chrome encrypts its profile on disk at the OS level (Windows DPAPI, macOS Keychain), but there is no application-level encryption layer.

5. **`test_data_messages`** may contain real message content from developer testing sessions if accidentally left in storage.

6. **`mcp_prompt_<requestId>` family** contains permission prompt data briefly and is removed on response, so exposure window is minimal.

---

## (g) Rebuild Guidance — What to Persist

For an OpenRouter-based rebuild controlling Chrome via Native Messaging, the minimal storage model is:

### Must Persist

| Key | Reason |
|-----|--------|
| `accessToken` / `refreshToken` / `tokenExpiry` | Replace with OpenRouter API key or your own OAuth |
| `anthropicApiKey` | Rename to `openrouterApiKey` or similar |
| `permissionStorage` | Core safety model — keep the `Permission[]` schema |
| `lastPermissionModePreference` | UX continuity across sessions |
| `browserControlPermissionAccepted` | First-run gate |
| `savedPrompts` | User's saved shortcuts library |
| `savedPromptCategories` | Organizational metadata |
| `scheduledTaskLogs` + `scheduledTaskStats` | Task history |
| `anonymousId` | Analytics if needed (can be removed) |
| `selectedModel` | Sticky model selection |
| `notificationsEnabled` | Notification preferences |
| `preferred_locale` | i18n |
| `bridgeDeviceId` | Stable device identity for Native Messaging pairing |
| `bridgeDisplayName` | Pairing display name |

### Anthropic-Specific / Can Drop

| Key | Reason to Drop |
|-----|----------------|
| `oauthState`, `codeVerifier`, `lastAuthFailureReason`, `accountUuid` | Replace with your own auth scheme |
| `features` | Anthropic remote feature-flag cache — replace with your own flags |
| `modelOverrideSeen` | Anthropic model-override UX logic |
| `announcementDismissed` | Anthropic product announcements |
| `test_data_messages` | Developer tooling |
| `tabGroups`, `dismissedTabGroups`, `mcpTabGroupId`, `mcpConnected` | Keep if you replicate the Chrome tab-grouping UI behavior |
| `updateAvailable` | Extension update badge — keep if desired |
| `tipDisplayCounts` | UI tips system |
| `targetTabId` | Scheduled task session management — simplify |
| `pendingScheduledTask` | Options page handoff — keep if you have scheduled tasks |
| `cicStripExtensionInterference`, `captureScreenshotClipScale` | Kill-switches for specific behaviors — replace with your own config |
| `debugMode`, `showTraceIds`, `showSystemReminders`, `systemPrompt`, etc. | Developer settings — redesign for your needs |

### New Keys You Will Need

- `openrouterApiKey` — primary auth credential
- `mcpServerUrl` or `nativeHostName` — which server/host to connect to
- Any per-model settings specific to OpenRouter

---

## (h) Open Questions

1. **Who writes `debugMode`, `showTraceIds`, `showSystemReminders`, `useSessionsAPI`, `sessionsApiHostname`, `perfTracePill`, `systemPrompt`?**
   The production options page internal tab is hard-coded to `false` (`i=!1`). These keys are only *read* by the sidepanel. In production builds these settings must be set manually via Chrome DevTools → Application → Storage. They appear to be developer/QA toggles with no production UI.

2. **Is there a schema version migration system not found in the analyzed bundles?**
   The `clearAllStorage()` on logout implicitly resets state. There may be version-guarded migrations in chunks not analyzed (e.g., `chunk-*.js` files).

3. **What is the precise `PermissionPrompt` type in `mcp_prompt_<requestId>`?**
   The shape is passed from the background to the permission window. It includes at minimum `{ tool: string, url?: string, actionData?: { screenshot?: string, coordinate?: number[] } }` based on the permission UI rendering, but a full schema was not confirmed.

4. **Are `savedPrompts` alarm names always equal to `SavedPrompt.id`?**
   Code shows `chrome.alarms.create(e.id, ...)` and alarm names checked with `.startsWith("prompt_")`. This appears reliable.

5. **What happens to `tabGroups` on extension restart?**
   The `W.loadFromStorage()` hydrates from `chrome.storage.local` on initialization. However, Chrome tab group IDs are session-specific; stale group IDs after restart are likely abandoned gracefully (the code calls `chrome.tabGroups.get(e)` and falls through on failure).
