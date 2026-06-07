# MCP Protocol Analysis — Claude in Chrome v1.0.75

**Source files examined (byte-offset extraction; files are minified):**
- `assets/mcpPermissions-8PlHLvdl.js` (281 KB) — primary: tool registry, bridge client, tool executor
- `assets/service-worker.ts-BsAUV92e.js` (17 KB) — native-messaging host handling, MCP lifecycle
- `assets/PermissionManager-BBDx9xIl.js` — permission type enum, `REMOTE_MCP` gate
- `assets/sidepanel-BL0NRfq2.js` — analytics event names, connector onboarding references

**Prior docs consumed (not redone):**
- Doc 01 — 23-tool catalog
- Doc 02 — transport channels (WebSocket bridge + native messaging), envelope shapes
- Doc 04 — permission system

---

## (a) Summary

The extension does **not** implement the Model Context Protocol spec as either a JSON-RPC 2.0 server or client. Neither `tools/list`, `tools/call`, `initialize`, `resources/*`, `prompts/*`, nor any other MCP method name appears in the codebase. The word "jsonrpc" occurs exactly once, in a single notification envelope sent over native messaging. The word "tools/list" and "tools/call" do not appear at all.

What the extension implements is a **pair of proprietary binary-on-top-of-JSON application-layer protocols** — one over WebSocket, one over Chrome's native-messaging IPC — that carry Anthropic-specific type-discriminated JSON objects. The word "MCP" appears throughout the codebase as a semantic label ("MCP tab group", "MCP connected", "MCP mode") meaning *any external client connecting through the bridge*, not the Model Context Protocol.

The practical implication for the open-source equivalent: **our server should expose a real MCP `tools/list` / `tools/call` JSON-RPC 2.0 interface**. The extension uses neither; any standard MCP harness (Claude Code, Cursor, etc.) connects using real MCP, and the extension itself was designed for a proprietary bridge. Our server will be the first component in this stack to speak actual MCP.

---

## (b) Is This Real MCP? Verdict with Evidence

**Verdict: No. The wire protocol is custom / proprietary, not MCP.**

### Evidence

#### 1. JSON-RPC / method names

The string `"jsonrpc"` appears exactly once in the entire codebase (`service-worker.ts-BsAUV92e.js`, byte 11964):

```javascript
// source: service-worker.ts-BsAUV92e.js, byte ~11950
const a = {
  type: "notification",
  jsonrpc: "2.0",
  method: e,
  params: t || {}
};
N.postMessage(a); // N = native messaging port
```

This is outbound only (extension → native host) and carries through-forwarded notifications. It is not part of an RPC request-response cycle; there is no `id` field, no `result`, no `error`. It is a fire-and-forget notification appended with the jsonrpc version string, presumably because the native host (Claude Code) expects to see it for compatibility. The method name (`e`) comes from the harness via `SEND_MCP_NOTIFICATION` internal message.

#### 2. No `tools/list`, `tools/call`, `initialize`

Grepping across all JS assets confirms: the strings `"tools/list"`, `"tools/call"`, `"resources/list"`, `"prompts/list"`, `"2024-11-05"`, `"2025-03-26"` (MCP protocol version strings) do not appear anywhere.

The string `"initialize"` appears 22 times across the codebase but always as an internal JavaScript method call (e.g., `await j.initialize()` on the tab-group manager class `W`), never as an MCP `initialize` request method.

#### 3. The actual wire protocol

The extension exchanges flat JSON objects identified by a `type` string discriminator:

- **WebSocket bridge**: `"tool_call"` (in), `"tool_result"` (out), `"peer_connected"`, `"peer_disconnected"`, `"pairing_request"`, `"permission_request"`, `"notification"` — documented fully in doc 02.
- **Native messaging**: `"tool_request"` (in), `"tool_response"` (out), `"mcp_connected"`, `"mcp_disconnected"`, `"ping"`, `"pong"`, `"get_status"`, `"status_response"`, `"notification"` — documented fully in doc 02.

No JSON-RPC `id` correlation, no `jsonrpc:"2.0"` on request-response pairs, no method routing layer.

#### 4. The SDK embedded in the extension is the Anthropic TypeScript SDK

The extension bundles `https://api.anthropic.com` as `DEFAULT_BASE_URL`, exposes `new Anthropic({apiKey, authToken})`, `Messages`, `Models`, `Beta`, etc. This SDK is used to call the Anthropic API **on behalf of the in-browser agent** (the side-panel LLM session). It is not an MCP SDK and does not implement MCP server or client roles.

---

## (c) Provider Side: How the Extension Exposes Browser Tools to a Harness

### The tool registry

The full tool array is the `Cn` variable in `mcpPermissions-8PlHLvdl.js`. Each tool object has:

```
{
  name: string,
  description: string,
  parameters: object,           // internal JSON Schema
  execute: async (args, context) => result,
  toAnthropicSchema: async (context) => {  // produces the Anthropic API tool definition
    name: string,
    description: string,
    input_schema: { type: "object", properties: {...}, required: [...] }
  }
}
```

The `toAnthropicSchema()` method produces **Anthropic Messages API tool format** (`input_schema`, not `parameters`), not MCP format. The schema is used when the extension calls `anthropicClient.beta.messages.create(...)` directly, not for any tools/list response.

### There is no `tools/list` response built by the extension

The extension never serializes the `Cn` array in response to a harness request. Instead, the harness must know the tool list independently (e.g., the Claude Code harness ships a hard-coded or separately fetched list of browser tool schemas). The extension simply executes whatever `tool` name arrives in a `tool_call` / `tool_request` message.

### How `tools/call` maps to tool execution

**WebSocket path** (bridge):

```
Harness → bridge relay → Extension WebSocket:
  { "type": "tool_call", "tool_use_id": "toolu_x", "tool": "navigate",
    "args": { "url": "https://..." }, "session_scope": {...}, ... }

Extension → bridge relay → Harness:
  { "type": "tool_result", "tool_use_id": "toolu_x",
    "result": { "content": [{ "type": "text", "text": "..." }] } }
  // or "error": { "content": [...] } on failure
```

The extension dispatcher (`Zn` function, byte ~274500) looks up the tool by name in `Cn`, calls `tool.execute(args, context)`, then posts the result.

**Native messaging path** (local harness):

```
Host → Extension:
  { "type": "tool_request", "method": "execute_tool",
    "params": { "tool": "navigate", "args": {...}, "client_id": "...", "session_scope": {...} } }

Extension → Host:
  { "type": "tool_response", "result": { "content": "..." } }
  // or "error": { "content": "..." }
```

The dispatcher is the same `Zn` function; only the `source` field differs (`"bridge"` vs `"native-messaging"`).

### Capability negotiation / initialize handshake

**There is none from the harness perspective.** The bridge's handshake is the `"connect"` message sent by the *extension* on WebSocket open:

```json
{
  "type": "connect",
  "client_type": "chrome-extension",
  "device_id": "<uuid>",
  "os_platform": "macOS",
  "extension_version": "1.0.75",
  "display_name": "Work laptop",
  "oauth_token": "<claude.ai OAuth token>"
}
```

The server replies with `"paired"` or `"waiting"`. No protocol version negotiation, no capabilities object.

### Tool result shape (content blocks)

Both channels return Anthropic Messages API content-block arrays:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_x",
  "result": {
    "content": [
      { "type": "text", "text": "Navigation complete. Current URL: https://example.com" }
    ]
  }
}
```

Error results set `"error"` instead of `"result"` at the top level, with the same `content` structure inside. Screenshots include `{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }` blocks.

---

## (d) Client Side: Connector Servers, Transport, Auth

### No MCP client to external connector servers found

The extension contains no code that acts as an MCP client connecting to remote Google Workspace, Slack, or M365 MCP servers. The `connector` and `m365` strings that appear in `sidepanel-BL0NRfq2.js` are **analytics event names** (e.g., `"claudeai.mcp.m365_setup_modal.viewed"`, `"extended_onboarding.connector.completed"`) and **icon type strings** (e.g., `"connectorSmall"`). They reference UI onboarding flows and telemetry for features that live on the `claude.ai` web app, not in the extension.

Similarly, `"claudeai.mcp.auth.init"`, `"claudeai.mcp.create_server"`, `"claudeai.mcp.delete_server"` are analytics event schemas for the claude.ai MCP management UI — the extension simply ships these event definitions so the side panel (which loads `claude.ai` content) can fire them.

**Conclusion**: The integration with remote connector servers (Google Workspace, Slack, M365) happens inside the `claude.ai` web app and/or in Claude Desktop/Code, not in the Chrome extension. The extension does not speak MCP-over-SSE or MCP-over-HTTP to any external server.

### OAuth used by the extension

The extension uses OAuth in one context only: **authenticating to Anthropic's own services**:

1. **claude.ai OAuth** — an OAuth access token issued by `claude.ai`, stored in `chrome.storage.local` under `ACCESS_TOKEN`. Used as `oauth_token` in the WebSocket bridge `connect` handshake, and as a `Bearer` token when calling `https://api.anthropic.com/api/web/url_hash_check/browser_extension` (the URL safety check API). [PermissionManager byte ~40327; mcpPermissions byte ~7605]

2. **Anthropic API auth** — for the in-browser agent's LLM calls, either `apiKey` (user-provided) or `authToken` (the OAuth token) is passed to the bundled Anthropic SDK. The beta flag `"oauth-2025-04-20"` is set on `messages.create` calls. [mcpPermissions byte ~270305]

No OAuth flows target third-party services.

### Transport findings

| Transport | Purpose | Found |
|---|---|---|
| WebSocket `wss://bridge.claudeusercontent.com/chrome/<id>` | Harness → extension tool calls (primary) | Yes |
| Native messaging (`com.anthropic.*`) | Harness → extension tool calls (local) | Yes |
| HTTPS `api.anthropic.com` | Extension → Anthropic API (agent LLM calls) | Yes |
| SSE / HTTP MCP to connector servers | Extension → Google/Slack/M365 | **Not found** |

---

## (e) The `_mcp` Tool Variant Explanation

### What `_mcp` means

The `_mcp` suffix denotes tools that operate on the **MCP tab group** — a Chrome tab group (`chrome.tabGroups`) that is created specifically for external-harness sessions and managed independently of user tabs. The three `_mcp` tools are:

| Tool | Purpose |
|---|---|
| `tabs_context_mcp` | Get tab IDs in the MCP group (optionally create if empty) |
| `tabs_create_mcp` | Open a new tab inside the MCP group |
| `tabs_close_mcp` | Close a specific tab in the MCP group |

Their counterparts `tabs_context` and `tabs_create` (without `_mcp`) work on whatever tab the side-panel session is attached to, without any group isolation.

### Why they exist

The `Mn` constant (byte ~266929) is `["tabs_context_mcp", "tabs_create_mcp", "tabs_close_mcp"]`. It is used in `Dn.handleToolCall` (byte ~267141):

```javascript
if (!this.context.tabId && !Mn.includes(e)) throw new Error("No tab available");
```

This means: `_mcp` tools are the **only ones that can run without a pre-existing `tabId`** in context. All other tools require a tab. This is the bootstrapping contract — a harness **must** call `tabs_context_mcp` first to establish a tab group (and get a `tabId`), before calling any browser-automation tool. This mirrors the description text: *"CRITICAL: You must get the context at least once before using other browser automation tools."*

### Session scoping logic

When `session_scope` is set in the tool call (bridge mode), the extension uses per-session tab groups managed by `getOrCreateSessionTabContext`. Without `session_scope` (legacy/shared mode), a single shared MCP group (keyed `"__legacy_shared__"`) is used. The constant `"mcp-native-session"` (`Ve`, byte ~128902) is the special session ID for native-messaging tool calls.

### Summary

The `_mcp` suffix is a **tab-group scoping mechanism**, not an MCP protocol mechanism. It tells the extension to route the tab operation to the isolated harness-owned tab group rather than the user's regular browsing tabs.

---

## (f) How the Native-Messaging Envelope Relates to MCP

Doc 02 documented the envelope shapes; this section adds the MCP-layer interpretation.

### Relationship

```
                     ┌─────────────────────────────────────────────────────┐
                     │ Native Messaging Wire (Chrome IPC)                   │
                     │                                                       │
                     │  tool_request / tool_response  (custom JSON)         │
                     │  notification { jsonrpc:"2.0", method, params }      │
                     │                                                       │
                     └───────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
                     Is this MCP?  NO.
                                     │
                                     │  The "jsonrpc":"2.0" field appears only on
                                     │  outbound notification fire-and-forget
                                     │  messages. Request-response pairs (tool_request
                                     │  / tool_response) have no jsonrpc, no id,
                                     │  no method-routing at the JSON-RPC layer.
```

The native host (`com.anthropic.claude_code_browser_extension`) is the **Claude Code CLI's native-messaging host**. It receives `tool_response` messages and sends `tool_request` messages. The fact that `tool_request` has a `method: "execute_tool"` field is superficially JSON-RPC-like but lacks `jsonrpc:"2.0"` and `id`. It is a single fixed method with no dispatch layer.

The `notification` messages (with `jsonrpc:"2.0"`) flowing from the extension to the native host are likely forwarded by the native host to a connected MCP session on the Claude Code side. This means:

- **Claude Code ↔ native host**: speaks real MCP (Claude Code is an MCP harness)
- **Native host ↔ extension**: speaks the custom `tool_request`/`tool_response` protocol
- The native host acts as an **adapter/proxy** between the two protocols

The extension has no visibility into what the native host does internally — it only sees the custom protocol layer.

### The `notification` forwarding

When a `SEND_MCP_NOTIFICATION` message arrives at the service worker (from the side panel), it is forwarded simultaneously to:

1. The native host: `{ type: "notification", jsonrpc: "2.0", method: e, params: t }` — forwarded as a proper JSON-RPC notification
2. The WebSocket bridge: via `u(e.method, e.params)` — forwarded as `{ type: "notification", method: e, params: t }` without the `jsonrpc` field

The `u` function imported from `PermissionManager-BBDx9xIl.js` handles the bridge side. This is the one place notifications flow from the browser extension *outward* to the harness.

---

## (g) Rebuild Guidance: Should Our MCP Server Expose Standard `tools/list`/`tools/call`?

**Yes, unambiguously. Expose a fully spec-compliant MCP server.**

### Rationale

The extension was designed for Anthropic's own proprietary bridge. Our open-source equivalent's goal is for *any* MCP harness (Claude Code, Cursor, Cline, custom agents) to drive the browser. Standard MCP is the right interface because:

1. **Harnesses expect MCP.** Claude Code speaks real MCP; it connects to MCP servers via `tools/list` + `tools/call`. The native host in the extension is the adapter that hides the extension's custom protocol — we eliminate that adapter by speaking MCP natively.

2. **No `tools/list` exists in the extension to copy.** The harness currently knows the tool list out-of-band. An MCP server's `tools/list` response is the correct place to publish the schema. Use the 23-tool schemas from doc 01 as the `tools` array, using MCP's `inputSchema` field.

3. **`initialize` handshake is required by spec.** MCP harnesses send `{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05", "capabilities": {...} } }` on connection. Our server must respond with `{ "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "2024-11-05", "capabilities": { "tools": {} }, "serverInfo": { "name": "open-browser-control", "version": "..." } } }`.

4. **`tools/call` is the correct dispatch method.** Harnesses send `{ "jsonrpc": "2.0", "id": N, "method": "tools/call", "params": { "name": "navigate", "arguments": { "url": "..." } } }`. Our server maps this to Chrome extension tool execution.

5. **Transport.** The MCP spec supports both SSE+HTTP and streamable HTTP (the newer "HTTP with SSE" transport). For a browser extension setting, **stdio** (for Claude Code CLI integration) or **streamable HTTP** (for remote harnesses) are the right transports. SSE-over-HTTP is the most widely supported for non-local use.

6. **`_mcp` tab group semantics.** Our server should implement the same session-scoped tab group logic. Each MCP session gets its own tab group; `tabs_context_mcp` is the bootstrapping call. The MCP session ID (from the `initialize` handshake or a custom extension) maps to a tab group.

### Recommended `tools/list` response skeleton

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "navigate",
        "description": "Navigate the current tab to a URL...",
        "inputSchema": {
          "type": "object",
          "properties": {
            "url": { "type": "string", "description": "The URL to navigate to" }
          },
          "required": ["url"]
        }
      },
      ...
    ]
  }
}
```

Note: MCP uses `inputSchema` (not Anthropic SDK's `input_schema`). See doc 01 for all 23 tool schemas — they need straightforward renaming from `input_schema` to `inputSchema`.

### `_mcp` tools in an MCP server

In our server, `tabs_context_mcp`, `tabs_create_mcp`, and `tabs_close_mcp` should be exposed as their clean names without the `_mcp` suffix (or with — the suffix is meaningful in the extension context but is arbitrary in ours). The critical behavior to preserve: these three tools must be callable **before** any tab context exists (they bootstrap it), while all other tools require a tab ID.

### Permission modes

The `permission_mode` field in the extension's tool calls (`"ask"`, `"follow_a_plan"`, `"skip_all_permission_checks"`) can be implemented as a per-session configuration, passed either in the `initialize` params or as a custom `set_permission_mode` tool. The extension's `Nn = new Set(["set_permission_mode"])` treats this tool specially (silent, no analytics logging).

---

## (h) Open Questions

1. **What does the native host send as `notifications` method names?** The extension blindly forwards whatever method string the harness injects via `SEND_MCP_NOTIFICATION`. The specific notification methods used are not observable from the extension side — they depend on what Claude Code requests. Likely candidates per MCP spec: `notifications/tools/list_changed`.

2. **Is there a hidden MCP layer in the native host binary?** The extension code only shows the custom `tool_request`/`tool_response` protocol. The actual native host binary (`com.anthropic.claude_code_browser_extension`) is not in the extension package. It may implement full MCP on its Claude Code-facing side and adapt to the extension's custom protocol on the other. This would explain the `jsonrpc:"2.0"` field on notifications — the native host may reconstruct MCP notifications from them.

3. **How do remote connectors (Google Workspace, Slack, M365) integrate?** No connector client code was found in the extension. These integrations appear to live entirely within `claude.ai` web app and Claude Desktop, not the browser extension. Confirmation would require analysis of Claude Desktop's internal MCP client.

4. **Does the bridge relay perform any MCP translation?** The `bridge.claudeusercontent.com` relay is a server-side component not present in the extension package. It may accept real MCP from harnesses and translate to the custom `tool_call`/`tool_result` protocol before forwarding to the extension. If so, harnesses may already be sending MCP to the bridge. Unconfirmed.

5. **`session_scope` object structure.** The `session_scope` field appears in both bridge and native-messaging `tool_call` envelopes but its full schema is not reconstructable from the extension code. It at minimum contains `sessionId` (used as a key for per-session tab groups) and `displayName`.

6. **Beta flag `"oauth-2025-04-20"`.** The extension uses this Anthropic beta flag for its own LLM calls. It is not related to the bridge protocol; it enables server-side OAuth token handling in the Messages API. No action needed for the MCP server.
