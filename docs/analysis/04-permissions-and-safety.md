# Claude in Chrome v1.0.75 — Permission & Safety Model Analysis

**Extension root:** `.var/1.0.75_0/`  
**Primary sources greppd:** `assets/PermissionManager-BBDx9xIl.js`, `assets/mcpPermissions-8PlHLvdl.js`, `assets/sidepanel-BL0NRfq2.js`, `assets/useStorageState-C6Ou-D0H.js`, `assets/options-DxcKhBKM.js`, `i18n/en-US.json`, `managed_schema.json`, `blocked.html`, `manifest.json`

All quoted strings are lifted verbatim from minified source or i18n JSON.

---

## (a) Summary

The extension's safety model has **three interlocking layers**:

1. **URL-category blocklist** — every URL is classified by Anthropic's cloud API into one of five categories (category0–category3 + category_org_blocked). Hard-blocked categories cause navigation to be redirected to `blocked.html` or tool calls to be refused outright.
2. **Per-origin permission store** — user choices (allow/deny, once/always) are stored in `chrome.storage.local` under the key `permissionStorage`, keyed by **network location (hostname)**. Domain-transition permissions are stored separately.
3. **Session-scoped permission mode** — each conversation is sent with one of three permission modes (`follow_a_plan`, `skip_all_permission_checks`, or the legacy `ask` per-prompt mode). Modes gate whether the permission store is consulted at all.

---

## (b) Permission Model: Categories & Scope

### URL Risk Categories (server-side, Anthropic API)

All URL classification is performed by a live Anthropic API call to:
```
POST https://api.anthropic.com/api/web/url_hash_check/browser_extension
Authorization: Bearer <user-token>
Body: { "url": "<url>" }
```
The response includes `{ "category": "...", "org_policy": "block"|"allow" }`.

| Category | Meaning | Behavior |
|---|---|---|
| `category0` | Safe / uncategorized | No restriction |
| `category1` | Hard-blocked (Anthropic policy) | Redirect to `blocked.html`; tool calls refused |
| `category2` | Hard-blocked (Anthropic policy) | Same as category1 |
| `category3` | Sensitive but accessible | **Force-prompt on every action** (`forcePrompt=true`); "always allow" button is disabled (`shouldNotAllowSiteWidePermission=true`) |
| `category_org_blocked` | Blocked by enterprise managed policy | Redirect with message `"This site is blocked by your organization's policy."` |

Evidence — `mcpPermissions`:
```js
function An(e){return"category1"===e||"category2"===e||"category_org_blocked"===e}
// category3:
t.setForcePrompt(S)  // where S = "category3"===p
```
Category results are cached for `CACHE_TTL_MS = 300000` (5 minutes) to avoid repeated API calls.

**Category check flow:**
1. Managed-policy blocklist checked first (local, from `chrome.storage.managed`).
2. Then Anthropic cloud API is queried.
3. Result cached locally.
4. `An(category)` gates navigation and tool execution.

### Permission Scope: `Py` class (PermissionManager)

Permissions are stored as objects with three axis:
- **Scope type**: `netloc` (hostname-level) or `domain_transition` (fromDomain → toDomain pair)
- **Action**: `allow` | `deny` (enum `Ty`)
- **Duration**: `once` | `always` (enum `xy`)

```js
Ty = (t.ALLOW="allow", t.DENY="deny")
xy = (t.ONCE="once", t.ALWAYS="always")
```

**Tool-action types** (enum `Sy`, used as the "category" of the requested capability):
```js
Sy.NAVIGATE              = "navigate"
Sy.READ_PAGE_CONTENT     = "read_page_content"
Sy.READ_CONSOLE_MESSAGES = "read_console_messages"
Sy.READ_NETWORK_REQUESTS = "read_network_requests"
Sy.CLICK                 = "click"
Sy.TYPE                  = "type"
Sy.UPLOAD_IMAGE          = "upload_image"
Sy.DOMAIN_TRANSITION     = "domain_transition"
Sy.PLAN_APPROVAL         = "plan_approval"
Sy.EXECUTE_JAVASCRIPT    = "execute_javascript"
Sy.REMOTE_MCP            = "remote_mcp"
```

**Mapping from concrete tool actions to permission types** (from `mcpPermissions`):
```js
{
  screenshot:       l.READ_PAGE_CONTENT,
  scroll:           l.READ_PAGE_CONTENT,
  scroll_to:        l.READ_PAGE_CONTENT,
  zoom:             l.READ_PAGE_CONTENT,
  hover:            l.READ_PAGE_CONTENT,
  left_click:       l.CLICK,
  right_click:      l.CLICK,
  double_click:     l.CLICK,
  triple_click:     l.CLICK,
  left_click_drag:  l.CLICK,
  type:             l.TYPE,
  key:              l.TYPE,
}
```
The `navigate` tool maps to `Sy.NAVIGATE`. `javascript_tool` maps to `Sy.EXECUTE_JAVASCRIPT`. `find` maps to `Sy.READ_PAGE_CONTENT`.

**Permission scope is per-hostname (netloc), not per-tool-action type.** A single "always allow" for `github.com` covers all of click, type, navigate, screenshot, read-page, and execute-javascript.

**Hostname matching** (`matchesNetloc`):
- Trailing dot stripped from hostname.
- `www.` prefix stripped.
- Wildcard patterns supported: `*.example.com` matches `sub.example.com` and `example.com`.

There is no per-tool-category granularity in what the user approves — approval is all-or-nothing per hostname.

---

## (c) Approval Flow & Persistence

### Permission Modes (session-level)

The sidepanel stores a `permissionMode` in a Zustand store. Three values are used in practice:

| Mode value | Label in UI | Behavior |
|---|---|---|
| `follow_a_plan` | "Ask before acting" | Default; Claude plans first, user approves plan; per-site prompts for other sites |
| `skip_all_permission_checks` | "Act without asking" | Skips all per-site prompts; HIGH RISK warning shown; requires explicit user confirmation |
| `ask` | (legacy per-action mode) | Each action is prompted individually; shown for category3 sites |
| `allow_for_site` | (implicit mode) | Set automatically when the current site already has a stored `ALWAYS` permission |

The default `permissionMode` is initialized as `"ask"` unless `?skipPermissions=true` URL param is set (test/debug).

Modes are sent with each tool call invocation as `permissionMode` field via the bridge protocol.

### Approval Flow for a Normal Tool Call

1. Tool invocation arrives (either from side panel chat or via MCP bridge).
2. URL category is checked (`getCategory`). If `category1/2/org_blocked` → refuse immediately.
3. If `category3` → `forcePrompt = true` (always prompt, never auto-allow).
4. `permissionManager.checkPermission(url, toolUseId)` is called:
   - If `getSkipAllPermissions()` returns true (i.e. `skip_all_permission_checks` mode) → `{allowed: true}` immediately.
   - If URL is in `turnApprovedDomains` (plan-approved domains for this turn) → `{allowed: true}`.
   - Looks up stored permissions by netloc.
   - ONCE-duration permissions are matched by `toolUseId` and revoked after use.
   - ALWAYS-duration permissions are cached and reused.
   - If no match → `{allowed: false, needsPrompt: true}`.
5. If `needsPrompt`: tool execution pauses; `permission_required` result is returned.
6. The sidepanel's `onPermissionRequired` callback is invoked. It:
   - Displays the permission prompt UI in the side panel.
   - Sends a `SHOW_PERMISSION_NOTIFICATION` Chrome notification message.
   - Returns a `Promise` that resolves when the user responds.
7. User sees the permission prompt with three choices:
   - **"Always allow actions on this site"** → `grantPermission(scope, ALWAYS)` (disabled for category3 sites)
   - **"Allow once"** → `grantPermission(scope, ONCE, toolUseId)`
   - **"Decline"** / Escape → `denyPermission(scope, ...)` (only persisted if duration is ALWAYS)
8. After grant, the tool call is **retried once**.

### "Plan" Approval Mode (`follow_a_plan`)

When the `follow_a_plan` permission mode is active, Claude first calls an `update_plan` tool presenting its intended domains and steps. The user approves or rejects the plan. Approved domains are placed into `turnApprovedDomains` (a session-scoped `Set` on the `Py` instance). These domains bypass per-action prompts for the duration of the turn. Rejected plan → `"Plan rejected by user"` error code `plan_rejected_user`.

Domains that are category1/2/org_blocked are filtered out of the plan before showing the user (they cannot be approved):
```js
const {approved, filtered} = await filterBlockedDomains(domains);
```

### Persistence

All site permissions are stored in `chrome.storage.local` under key `permissionStorage`:
```json
{ "permissions": [ { "id": "uuid", "scope": {...}, "action": "allow|deny", "duration": "once|always", "createdAt": 1234567890, "lastUsed": 1234567890, "toolUseId": "..." } ] }
```
`lastUsed` is updated on every read. ONCE-duration permissions are consumed (revoked) on use.

Storage changes are listened for via `chrome.storage.onChanged` to keep all open panels in sync.

The user can **revoke** stored permissions from the Options page (`options.html` → Permissions tab), which calls `permissionManager.revokePermission(id)`.

### MCP Bridge Source

When tool calls arrive over the MCP bridge (external client), the bridge message includes `permissionMode` and `allowedDomains` fields. The extension constructs a permission manager with:
```js
const skipAll = "skip_all_permission_checks" === permissionMode;
const pm = new PermissionManager(() => skipAll, {});
if ("follow_a_plan" === permissionMode && allowedDomains?.length)
  pm.setTurnApprovedDomains(allowedDomains);
```
If `handlePermissionPrompts=true` is in the bridge message and a `toolUseId` is provided, permission requests are routed back through the bridge as `permission_request` messages, and responses arrive as `permission_response` messages.

### `browser_batch` and Permissions

If a tool inside a `browser_batch` requires a permission prompt, the **entire batch call fails** with `batch_permission_required`, and Claude is instructed to call the tool standalone (not batched) so the user can be prompted.

---

## (d) URL / Site Blocking Algorithm

### Managed-Policy Blocklist (`blockedUrlPatterns`)

Loaded from `chrome.storage.managed` (enterprise MDM), key `"blockedUrlPatterns"`.

**Matching algorithm** (function `O` in `mcpPermissions`):
1. Parse URL; normalize: strip trailing `.`, strip `www.` prefix.
2. Combine `hostname + pathname` as the target string (lowercase).
3. Normalize the pattern: strip `http(s)://`, strip `www.`, strip trailing `.` before `/`, strip trailing `/` (replaced with `/*`). If no `/` in pattern, append `/*`.
4. Split on `*` and escape regex metacharacters; join with `.*`.
5. Test `^<pattern>$` against target.

In code:
```js
function O(url, pattern) {
  // target = hostname.lower + pathname.lower (no scheme, no www., no trailing dot)
  // pattern normalization: strip scheme, www., trailing slash → add *, then regex
  return new RegExp(`^${n}$`).test(target);
}
```

**Matching examples** (from `managed_schema.json` description):
- `"example.com/admin"` → blocks all pages under that path.
- `"github.com/myorg/*"` → blocks all pages under that path.
- `"example.com"` (no path) → treated as `"example.com/*"` → blocks all pages on domain.
- Patterns are **case-insensitive**.
- Leading `http://`, `https://`, or `www.` is ignored.

### Anthropic API Blocklist (categories 1 and 2)

For URLs not blocked by managed policy, `fetchCategoryFromAPI` is called. The response is cached for 5 minutes. Category1 and category2 URLs (Anthropic-policy-sensitive content: banking, health, adult, etc. — exact mapping is server-side and not exposed in the JS) trigger:
- Navigation tool: error `"This site is not allowed due to safety restrictions."`, errorCode `navigate_blocked_domain`.
- All other tools: refusal before execution.
- Tab-group tracking: redirected to `blocked.html`.

### `blocked.html` Page

When a tab that Claude is using navigates to a blocked URL, the extension may redirect to `blocked.html`. The page shows a plain message:
```
"The content on this page isn't available when Claude is active for safety reasons."
```
The blocked page is identified by URL containing `"blocked.html"` and is treated as `category1` in all blocklist checks. A button "Close blocked site" (`OarD7TkDBO`) appears.

The URL to redirect is encoded as `blocked.html?url=<encoded-url>`.

### Category3: Sensitive but Accessible

Category3 sites (e.g. banking, health, dating inferred from the i18n warning: `"avoid using Claude on sensitive sites like health and dating platforms"`) are not blocked outright. Instead:
- `forcePrompt = true` is set on the `PermissionManager` for the session as long as the tab is on a category3 URL.
- The "Always allow actions on this site" button is **disabled** in the permission prompt (`disableAlwaysAllow=true`, `shouldNotAllowSiteWidePermission=true`).
- The user must approve each individual action ("Allow once" only).
- In plan mode, the plan's list of domains shows category3 sites with a tooltip: `"You must approve any Claude action on this site"`.

### Domain Transition Checking

When the browser navigates from one domain to another (detected via `webNavigation` events), the extension checks `checkDomainTransition(fromDomain, toDomain)`. If not pre-approved:
- In `forcePrompt` mode → `{allowed: false, needsPrompt: true}`.
- If `toDomain` is in `turnApprovedDomains` → auto-allow.
- Otherwise → look up stored `domain_transition` permissions. If none → prompt.

The UI message shown when paused: `"Claude paused due to a navigation from <fromDomain> to <toDomain>"` (i18n key `xgz5co4oqe`).

Domain transition permissions are stored separately from netloc permissions and managed via their own UI section in Options ("Domain Transitions").

### Localhost Bypass

When `bypassLocalhostForMcp=true` (configurable), all localhost/127.x/`::1`/`*.localhost` URLs are automatically allowed without any permission check. Transitioning **from** localhost **to** non-localhost requires a prompt.

---

## (e) Org / Login Gating

### `forceLoginOrgUUID` Managed Policy

Loaded from `chrome.storage.managed` at sidepanel startup and on change.

Parsing function `uk(value)`:
- If `value` is a JSON array: parsed and each element lowercased.
- If `value` is a plain string: treated as a single UUID, lowercased, wrapped in array.
- Empty/invalid value: `null` (no restriction).

**Enforcement** in the sidepanel root component:
```js
if (forceLoginOrgUUIDs && userProfile &&
    !forceLoginOrgUUIDs.includes(userProfile.organization.uuid.toLowerCase()))
  return <OrgBlockedPage />;
```
The user is shown a blocking page (component `ik`) with a "Log in" button and the message:
```
"Your organization requires you to sign in with a specific account.
 Log out and sign in with an approved account."
```
(i18n key `/LzCz+T6Ti`)

The user profile's `organization.uuid` is compared against the managed list. If the signed-in user's org UUID is **not** in the list, the entire extension UI is replaced by the blocking page.

### Session Expiry / Auth Failure

The service worker tracks an `LAST_AUTH_FAILURE_REASON` storage key. If `"session_expired"`, all bridge tool calls are refused with:
```
"Authentication failed. The extension may need to be re-authenticated."
```

### Paid Account Requirement

The sidepanel checks `hasBrowserControlPermission` against `BROWSER_CONTROL_PERMISSION_ACCEPTED` (a boolean in `chrome.storage.local`). If the user has not accepted the browser-control consent, a first-time consent screen is shown and no tools execute. The extension also checks `chromeExtEligibility` (presumably requiring a paid plan); the i18n string says `"Claude in Chrome requires a paid plan"` (key `hg/DxQvpUn`).

---

## (f) Sensitive-Action Safeguards

| Action | Safeguard |
|---|---|
| **Purchases / account creation / CAPTCHA bypass** | Stated as explicitly off-limits in the "Always allow" confirmation footer: `"Claude will not purchase items, create accounts, or bypass captchas without input."` (i18n `zPbO6HcY5Z`). This is a policy statement displayed to the user, not a technical block in the code reviewed. |
| **JavaScript execution** | Requires `EXECUTE_JAVASCRIPT` permission check (same as other actions). Output post-processing: values containing `password`, `token`, `secret`, `api_key`, `auth`, `credential`, `private_key`, `access_key`, `bearer`, `oauth`, `session` regex patterns are flagged/blocked; cookie/query-string data containing `=` and `;` or `&` is blocked: `"[BLOCKED: Cookie/query string data]"`. |
| **Domain transitions** | Separate `domain_transition` permission check; prompts user whenever navigation crosses domain boundaries, even if the destination is already "allowed" for direct navigation. |
| **Category3 sites** | Per-action prompt mandatory; "always allow" disabled. Privacy disclaimer shown: `"For privacy, avoid using Claude on sensitive sites like health and dating platforms."` (key `hItngLUKCl`). |
| **Category1/2 sites** | Navigation refused entirely; tools refused before execution. |
| **File uploads** | `file_upload` tool is in the list of tools not batchable; requires individual call. No separate permission category beyond the normal netloc check. |
| **Screenshots** | `screenshot` action maps to `READ_PAGE_CONTENT` permission category. Disclaimer shown to user: `"Claude can take screenshots when responding."` |
| **Downloads** | Downloads use `chrome.downloads.download` API (extension has `downloads` manifest permission). No per-download user confirmation found in the reviewed code. Artifact downloads show: `"Artifacts are created by other users and aren't verified by Anthropic. Only download files you trust."` |
| **Prompt injection warning** | Warning shown in skip-all mode: `"Malicious code buried in sites may override your instructions in order to steal your data, inject malware into your systems, or take over your system to attack other users."` (key `bmDayxG7DJ`) and separately in first-time consent: `"Malicious actors can hide instructions in websites, emails, and documents..."` (key `DvXQDnOGPc`). No automated prompt-injection detection found in reviewed code. |
| **`skip_all_permission_checks` mode** | Requires user to click through a multi-bullet WARNING dialog confirming: (1) Claude can take any action on the internet, (2) puts data at risk from malicious code, (3) user is fully responsible, (4) user should review risks. Shows persistent "HIGH RISK" banner in UI. |
| **`browser_batch` with permission-required tool** | Batch fails with `batch_permission_required`; tool must be called standalone. |

---

## (g) Managed-Policy vs User Settings

### Enterprise-Managed (via `chrome.storage.managed`, MDM/GPO)

| Policy | Key | Effect |
|---|---|---|
| URL blocklist | `blockedUrlPatterns` | Array of URL patterns; blocks Claude from accessing matching pages. Checked before API category. Real-time updates via `onChanged` listener. |
| Org UUID restriction | `forceLoginOrgUUID` | Single UUID string or JSON array; blocks extension UI entirely if signed-in user's org UUID does not match. |

These are read-only from the extension's perspective; only IT admins can write them via MDM.

### User-Configurable (via `chrome.storage.local`, Options page)

| Setting | Key / Location | Effect |
|---|---|---|
| Permission mode | `lastPermissionModePreference` (storage key defined in PermissionManager constants) | `follow_a_plan` or `skip_all_permission_checks` |
| Site permissions | `permissionStorage` | JSON list of `{scope, action, duration}` objects |
| Browser control consent | `browserControlPermissionAccepted` | Boolean; must be `true` to use extension |
| Notifications enabled | `notificationsEnabled` | Task completion notifications |
| Target tab ID | `targetTabId` | Which tab the panel operates on |
| Anthropic API key | `anthropicApiKey` | Optional; alternative to OAuth (API key mode) |

Options page (`options.html`) shows:
- **Notifications** toggle.
- **Your approved sites** list (netloc scope) with Revoke buttons.
- **Domain Transitions** list with Revoke buttons.
- No direct UI to change permission mode (that is in the sidepanel chat bar).

### Session-Scoped (ephemeral, Zustand store)

- `permissionMode`: current mode for active conversation.
- `turnApprovedDomains`: domains approved via plan for current turn (cleared on next message).
- `permissionPrompt`: pending permission request data.

---

## (h) Recommendations for the Rebuild

### Must Reproduce

1. **Per-origin permission store** with `once` / `always` / `deny` / `session` durations. Store in persistent browser storage (e.g. `chrome.storage.local`). Key by hostname. Include `lastUsed` tracking for auditability.

2. **Permission prompt UI** with three choices: "Allow once", "Always allow for this site", "Decline". Shown in the side panel (not a browser dialog). For sensitive sites, disable "always allow". Retry the tool call after approval.

3. **`browser_batch` permission handling**: if any sub-action in a batch requires a prompt, fail the batch and instruct the model to call that tool standalone.

4. **Domain transition detection**: track navigations across origins using `webNavigation` events; prompt on unexpected domain hops.

5. **Managed blocklist** (even if simplified): support an admin-configurable list of blocked URL patterns with the same wildcard algorithm.

6. **`skip_all_permission_checks` warning**: require explicit user acknowledgment of risks before enabling; show persistent HIGH RISK banner while active.

7. **First-time consent screen**: do not allow any tool calls until the user has clicked through the consent warning about browser control risks.

8. **JavaScript output sanitization**: redact cookie/query-string data and values matching credential-related patterns from JS execution results.

### Should Reproduce

9. **URL category system**: the Anthropic API (`/api/web/url_hash_check/browser_extension`) is Anthropic-specific. For a rebuild, you need an alternative classification. At minimum, implement:
   - A static blocklist of known categories (banking, adult, government, health) mapped from public domain lists.
   - `blocked.html` redirect for hard-blocked pages.
   - Forced-prompt-per-action for sensitive (category3 equivalent) sites.

10. **`follow_a_plan` mode**: Claude proposes domains + approach before acting; user approves plan; approved domains are turn-scoped. Filter hard-blocked domains out of the plan.

11. **Org/login gating**: if targeting enterprise use, implement a managed-policy `forceLoginOrgUUID` equivalent for your SSO provider.

### Can Omit (Anthropic-Specific)

12. **API authentication gating**: the `BROWSER_CONTROL_PERMISSION_ACCEPTED` paid-plan check is Anthropic-specific. Replace with your own auth/subscription gate.
13. **Exact category API**: the `url_hash_check` endpoint is Anthropic's internal service. Cannot reuse; must replace.

---

## (i) Open Questions

1. **What exactly determines category1 vs category2?** The extension treats them identically (both hard-blocked). The distinction exists in the API response but is not exposed in the client code. Anthropic has not published the criteria.

2. **Is there any per-tool-type permission granularity exposed to the user?** Evidence suggests not — all tool actions on a site are covered by a single hostname permission. The `Sy` enum defines per-action types but they appear to be used only for the prompt description, not stored as separate permissions.

3. **How does the `"ask"` permissionMode (shown for category3 sites) differ from `"follow_a_plan"`?** The `"ask"` mode appears to be a legacy or per-site-override mode that forces per-action prompts; `"follow_a_plan"` is the default user-visible mode. Whether these two modes can coexist in the same session (category3 tab being forced to `"ask"` while global mode is `"follow_a_plan"`) is unclear.

4. **Are MCP REMOTE_MCP tool calls subject to the same netloc permission store?** The `Sy.REMOTE_MCP` action type exists, and `o3` component shows an MCP-specific permission prompt ("Allow for all chats"). The scope used is `{type: "netloc", netloc: ""}` (empty string). This likely means remote MCP server tool approvals are stored as a single global entry, not per-server. Uncertain.

5. **What does the `permissions_wait_ms` timing track, and is there a timeout after which a pending permission request is automatically denied?** No timeout code was found. If the side panel is closed while a permission is pending, the `Promise` may hang.

6. **Does the extension perform any JavaScript output truncation or size limits?** Pattern-based credential redaction was confirmed; size limits on JS result strings were not confirmed.

7. **Is `bypassLocalhostForMcp` user-configurable or hardcoded?** It appears in the constructor option but no UI was found that toggles it. Likely a developer/debug setting.
