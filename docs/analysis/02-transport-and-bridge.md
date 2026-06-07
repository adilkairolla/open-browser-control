# Transport and Bridge Architecture — Claude in Chrome v1.0.75

## (a) Summary

The extension uses **three parallel ingress channels** that all ultimately funnel tool calls into a single internal dispatcher:

1. **WebSocket bridge** (`wss://bridge.claudeusercontent.com/chrome/<device_id>`) — the primary channel used by the Claude Desktop / Claude Code harness. A custom application-layer protocol sits on top of raw WebSocket frames; messages are JSON objects with a `type` discriminator. The extension (service worker) is the *client* — it dials out to Anthropic's relay and stays connected.

2. **Native Messaging** (`com.anthropic.claude_browser_extension` / `com.anthropic.claude_code_browser_extension`) — a secondary channel for local harnesses (Claude Desktop app, Claude Code CLI running on the same machine). The service worker connects to a named native host; the host then sends `tool_request` messages using a thin JSON-RPC 2.0-flavoured envelope. Both channels expose the *same tool set*; the source field (`"bridge"` vs `"native-messaging"`) is passed into the tool dispatcher for bookkeeping only.

3. **`externally_connectable` (chrome.runtime.onMessageExternal)** — used only by `https://claude.ai` to complete the OAuth redirect and to probe extension presence (`ping`). It is *not* a tool-call channel.

Content scripts on `claude.ai` pages inject a tiny loader that relays a single `open_side_panel` message to the service worker when the user clicks an onboarding button — this is UI glue, not a control channel.

---

## (b) Channel Inventory

| Channel | Direction | Who uses it | Purpose |
|---|---|---|---|
| WebSocket `wss://bridge.claudeusercontent.com/chrome/<device_id>` | SW dials out | Claude Desktop / Claude Code (remote/cloud harness) | Primary tool-call delivery and result return |
| Native Messaging `com.anthropic.claude_browser_extension` | SW dials out | Claude Desktop app (same machine) | Local tool-call delivery |
| Native Messaging `com.anthropic.claude_code_browser_extension` | SW dials out | Claude Code CLI (same machine) | Local tool-call delivery |
| `chrome.runtime.onMessageExternal` (externally\_connectable) | Inbound from `https://claude.ai` | claude.ai web app | OAuth redirect completion, extension ping |
| `chrome.runtime.onMessage` (internal) | Bidirectional, SW ↔ side panel / offscreen | Side panel, pairing page, offscreen doc | Task execution, UI updates, sound, GIF export |
| `chrome.tabs.sendMessage` | SW → content script in target tab | Agent-visual-indicator content script | HIDE\_STATIC\_PILL, SHOW\_STATIC\_INDICATOR etc. |

---

## (c) Bridge Protocol and Envelope

### Connection URL

```
wss://bridge.claudeusercontent.com/chrome/<device_id>
```

- `<device_id>` is a `crypto.randomUUID()` generated once and stored in `chrome.storage.local` under key `"bridgeDeviceId"`. It persists across restarts. [Source: `mcpPermissions-8PlHLvdl.js`, byte ~242900]
- Staging variant (for development builds, per CSP): `wss://bridge-staging.claudeusercontent.com`

### Handshake (client → server, on WebSocket `onopen`)

```json
{
  "type": "connect",
  "client_type": "chrome-extension",
  "device_id": "<uuid>",
  "os_platform": "<e.g. macOS>",
  "extension_version": "1.0.75",
  "display_name": "Work laptop",
  "oauth_token": "<claude.ai OAuth access token>"
}
```

- `oauth_token` is only present when the connection is being initiated without an existing session (the boolean `e` flag suppresses it for reconnects). [Byte ~244000]
- `display_name` is optional; set during pairing.

### Server → Client message types

| `type` | Meaning |
|---|---|
| `"paired"` | Bridge accepted connection; a peer (harness) is already connected |
| `"waiting"` | Bridge accepted connection; no peer yet connected |
| `"ping"` | Keepalive ping from server |
| `"pong"` | Server's reply to an extension-initiated ping |
| `"peer_connected"` | A harness has connected to the same bridge slot |
| `"peer_disconnected"` | The harness disconnected |
| `"tool_call"` | Harness is requesting a browser tool execution |
| `"pairing_request"` | Harness is requesting user pairing |
| `"permission_response"` | Response to a permission prompt the extension raised |
| `"error"` | Protocol error |

#### `tool_call` envelope (inbound)

```json
{
  "type": "tool_call",
  "tool_use_id": "toolu_abc123",
  "tool": "navigate",
  "args": { "url": "https://example.com" },
  "target_device_id": "<uuid or null>",
  "client_type": "desktop",
  "permission_mode": "auto",
  "allowed_domains": ["example.com"],
  "handle_permission_prompts": true,
  "session_scope": "..."
}
```

- `target_device_id`: when set, only the matching extension instance processes the call (multi-device routing). [Byte ~244860]

#### `pairing_request` envelope (inbound)

```json
{
  "type": "pairing_request",
  "request_id": "<uuid>",
  "client_type": "claude-code"
}
```

### Client → Server message types

| `type` | Meaning |
|---|---|
| `"connect"` | Handshake (see above) |
| `"ping"` | Keepalive ping every 20 seconds |
| `"pong"` | Reply to a server ping |
| `"tool_result"` | Tool execution result |
| `"pairing_response"` | User accepted or dismissed the pairing prompt |
| `"notification"` | MCP notification forwarded to the harness |
| `"permission_request"` | Extension asking the harness for permission before executing a tool |

#### `tool_result` envelope (outbound)

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "result": {
    "content": [{ "type": "text", "text": "..." }]
  }
}
```

On error:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "error": {
    "content": [{ "type": "text", "text": "Error message" }]
  }
}
```

#### `pairing_response` envelope (outbound)

```json
{
  "type": "pairing_response",
  "request_id": "<uuid>",
  "device_id": "<extension device uuid>",
  "name": "Work laptop"
}
```

On dismiss:

```json
{
  "type": "pairing_response",
  "request_id": "<uuid>",
  "dismissed": true
}
```

#### `notification` envelope (outbound, for MCP notifications)

```json
{
  "type": "notification",
  "method": "<mcp-method-name>",
  "params": {}
}
```

When sent over native messaging the same notification adds `"jsonrpc": "2.0"`:

```json
{
  "type": "notification",
  "jsonrpc": "2.0",
  "method": "<mcp-method-name>",
  "params": {}
}
```

#### `permission_request` envelope (outbound, extension → harness via bridge)

```json
{
  "type": "permission_request",
  "tool_use_id": "toolu_abc123",
  "request_id": "<uuid>",
  "tool_type": "<tool name>",
  "url": "https://target.com",
  "action_data": {}
}
```

### Keepalive / Reconnect

- Ping sent from extension every **20 seconds** (`setInterval(..., 2e4)`). [Byte ~242920]
- If no pong received in time, the connection is closed with code `4001` ("pong-timeout"). [Byte ~249011]
- The OAuth token is refreshed every **30 minutes** (`18e5` ms). [Byte ~249080]
- Reconnect uses **exponential backoff**: `delay = min(2000 * 1.5^(attempt-1), 300000)` with ±20 % jitter. Max delay cap is **300 seconds** (`cn = 3e5`). [Byte ~248174]
- Close code `1008` (policy violation, e.g. bad token) increments a counter; after **2 consecutive 1008s** the stored access token is cleared and the user must re-authenticate. [Byte ~247400]

---

## (d) Pairing and Auth

### OAuth Token

The extension authenticates to the bridge using the claude.ai OAuth access token stored locally. `claude.ai` delivers the token by sending an `externally_connectable` message of type `"oauth_redirect"` with a `redirect_uri`. The service worker processes this via the `v()` function, then initiates a bridge connection. [SW byte ~17380]

### Device Identity

- `bridgeDeviceId`: a `crypto.randomUUID()` generated on first use, persisted in `chrome.storage.local`. This is the path component of the WebSocket URL and is sent as `device_id` in the `connect` handshake.
- `bridgeDisplayName`: a human-readable name set during pairing (e.g. "Work laptop"), stored in `chrome.storage.local`.

### Pairing Flow

1. A harness connects to the bridge and sends a `pairing_request` with a server-generated `request_id` and `client_type` (`"desktop"` or `"claude-code"`).
2. The bridge relays the request to the extension over WebSocket.
3. The service worker first tries `chrome.runtime.sendMessage({type: "show_pairing_prompt", ...})` to the side panel. If the side panel is not open, it falls back to opening `pairing.html?request_id=...&client_type=...&current_name=...` in a new tab.
4. The user types a name for their browser and clicks "Connect". `pairing.html` sends `chrome.runtime.sendMessage({type: "pairing_confirmed", request_id: ..., name: ...})` back to the service worker.
5. The service worker persists the display name and sends `{type: "pairing_response", request_id, device_id, name}` over the WebSocket bridge.
6. On dismiss, `{type: "pairing_response", request_id, dismissed: true}` is sent.

The `request_id` is a server-assigned opaque string (not a UUID generated by the extension). The extension deduplicates on it to avoid showing the same prompt twice (`vn` variable check). [Byte ~246686]

---

## (e) Native Messaging

### Host Names (tried in order)

1. `com.anthropic.claude_browser_extension` (label: "Desktop")
2. `com.anthropic.claude_code_browser_extension` (label: "Claude Code")

The service worker attempts to connect to each in turn by sending a `{type: "ping"}` and waiting up to 10 seconds for `{type: "pong"}`. The first that responds is used; others are disconnected. [SW byte ~650]

### Purpose

Native messaging provides a **local, zero-relay alternative to the WebSocket bridge** for harnesses (Claude Desktop app, Claude Code CLI) running on the same machine. It is used for:

- **Tool call delivery**: the native host sends `tool_request` messages.
- **MCP lifecycle signalling**: `mcp_connected` and `mcp_disconnected` messages drive the same `MCP_CONNECTED` state flag as the bridge's `peer_connected`/`peer_disconnected`.
- **Status queries**: `get_status` / `status_response` used by the options UI.

### Native Messaging Message Shapes

#### Host → Extension (inbound)

```json
{ "type": "tool_request", "method": "execute_tool", "params": {
    "tool": "navigate",
    "args": { "url": "https://example.com", "tabId": 42 },
    "client_id": "...",
    "tabGroupId": 5,
    "session_scope": "..."
}}
```

```json
{ "type": "status_response" }
{ "type": "mcp_connected" }
{ "type": "mcp_disconnected" }
{ "type": "pong" }
```

#### Extension → Host (outbound)

```json
{ "type": "tool_response", "result": { "content": "..." } }
{ "type": "tool_response", "error": { "content": "..." } }
{ "type": "get_status" }
{ "type": "ping" }
{ "type": "notification", "jsonrpc": "2.0", "method": "...", "params": {} }
```

### Permission Check

Before attempting native connection the service worker checks `chrome.permissions.contains({permissions: ["nativeMessaging"]})`. The user grants this from the options page (`options.html#permissions`). The `nativeMessaging` permission is declared in the manifest but can be dynamically removed/re-added.

---

## (f) Internal Message-Flow Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │              Anthropic Bridge Relay              │
                    │   wss://bridge.claudeusercontent.com/chrome/...  │
                    └──────────────────────┬──────────────────────────┘
                                           │  WebSocket (SW dials out)
                    ┌──────────────────────▼──────────────────────────┐
                    │                                                   │
  Native Host ──────►          Service Worker (SW)                    │
  (com.anthropic.*) │                                                   │
  chrome NativeMsg  │  Dispatches by source: "bridge" | "native-msg"  │
                    │                                                   │
  claude.ai page ───► onMessageExternal                               │
  (externally_conn) │  • oauth_redirect → auth → connect bridge       │
                    │  • ping → {success:true}                         │
                    │                                                   │
  pairing.html ─────► onMessage                                       │
  (ext page)        │  • pairing_confirmed → send pairing_response    │
                    │  • pairing_dismissed → send pairing_response    │
                    │                                                   │
  options.html ─────► onMessage                                       │
  (ext page)        │  • check_native_host_status → status            │
                    │  • logout → clear state                          │
                    │  • EXECUTE_SCHEDULED_TASK → launch task         │
                    └────┬────────────┬────────────┬───────────────────┘
                         │            │            │
              sendMessage│  sendMessage│  sendMessage
                         ▼            ▼            ▼
                   ┌──────────┐ ┌──────────┐ ┌──────────────┐
                   │ Side     │ │ Offscreen│ │ Content      │
                   │ Panel    │ │ Document │ │ Scripts      │
                   │(sidepanel│ │(offscreen│ │(target tabs) │
                   │.html)    │ │.html)    │ │              │
                   │          │ │          │ │              │
                   │EXECUTE_  │ │GENERATE_ │ │HIDE_STATIC_  │
                   │TASK      │ │GIF       │ │PILL          │
                   │STOP_     │ │OFFSCREEN_│ │SHOW_STATIC_  │
                   │AGENT     │ │PLAY_SOUND│ │INDICATOR     │
                   │POPULATE_ │ │REVOKE_   │ │HIDE_AGENT_   │
                   │INPUT_TEXT│ │BLOB_URL  │ │INDICATORS    │
                   └──────────┘ └──────────┘ └──────────────┘

  claude.ai content ──► chrome.runtime.sendMessage({type:"open_side_panel"})
  script (loaded on        └──► SW opens side panel for active tab
  claude.ai/* pages)
```

Key routing rules in the SW:
- `tool_call` from bridge → calls `Zn()` with `source:"bridge"`, result sent back as `tool_result` over bridge
- `tool_request` from native host → calls same dispatcher with `source:"native-messaging"`, result sent as `tool_response` via `N.postMessage()`
- `SEND_MCP_NOTIFICATION` internal message → forwarded to native host AND to bridge as `notification`
- Offscreen document is kept alive primarily to prevent SW hibernation; it also handles audio and GIF encoding

---

## (g) Anthropic-Infra-Specific vs Generic — Replacement Strategy

### What is Anthropic-specific

| Component | Why it is Anthropic-specific |
|---|---|
| `wss://bridge.claudeusercontent.com` | Anthropic-hosted relay; requires a valid claude.ai OAuth token in the `connect` handshake |
| OAuth token flow | Obtained via `claude.ai` web app; delivered over `externally_connectable`; used to authenticate the WebSocket connection |
| Native host names `com.anthropic.*` | These are the names of Anthropic-shipped native messaging host executables (Claude Desktop, Claude Code) |
| `externally_connectable` origin `https://claude.ai` | Only the claude.ai web app can trigger OAuth delivery |
| Bridge-side `device_id` routing | The bridge relay manages device sessions; multi-device dispatching via `target_device_id` is relay-side logic |

### What is Generic / Replaceable

| Component | How to replace |
|---|---|
| WebSocket transport protocol | The application-layer message format (`type`, `tool_use_id`, `tool`, `args`, `tool_result`) is entirely generic JSON. Any WebSocket server can speak it. |
| Native Messaging transport | The `tool_request`/`tool_response` envelope over native messaging is also generic and does not carry Anthropic-specific fields. Any local process registering a native messaging host can use it. |
| Internal routing (SW ↔ side panel ↔ content scripts) | Purely Chrome extension APIs; nothing Anthropic-specific. |

### Proposed Local MCP Transport

To replace the Anthropic bridge, implement a **local WebSocket server** that speaks the same application-layer protocol:

1. **Local relay server** listens on e.g. `ws://localhost:9876`.
2. **Patch the bridge URL** in the extension (or fork it): replace `wss://bridge.claudeusercontent.com/chrome/${device_id}` with your local URL.
3. **Remove the OAuth gate**: the `connect` handshake's `oauth_token` field can be replaced with a local shared secret or omitted.
4. **MCP server side**: the relay receives the extension's `connect` message, then forwards `tool_call` messages and awaits `tool_result` replies — this maps cleanly onto the MCP `tools/call` request/result cycle. The relay acts as the MCP server; the extension is an MCP client executing tools.
5. **Pairing**: simplified — the `pairing_request`/`pairing_response` round-trip can be pre-confirmed or replaced with a simple token match.
6. **Native Messaging alternative**: for a purely local setup, a native messaging host is simpler to implement (no WebSocket at all) and avoids CORS/CSP issues. The host just needs to handle `tool_request`→`tool_response` framing.

The **cleanest replacement** for an open-source, harness-agnostic controller: implement a local WebSocket server, adopt the same JSON message envelope (only `type`, `tool_use_id`, `tool`, `args`, `tool_result` are required — all other fields are optional metadata), and patch the bridge URL. No other Anthropic infrastructure is needed.

---

## (h) Open Questions

1. **How does the bridge relay identify/authenticate the harness side?** We observe the extension authenticates with `oauth_token`; the harness (Claude Desktop / Claude Code) presumably authenticates separately to the same relay, but the harness-side protocol is not visible in the extension source.

2. **Is `target_device_id` set by the harness or the relay?** The field is present in `tool_call` messages received by the extension. It is plausible the relay injects it, but we cannot confirm from extension code alone.

3. **What is the full set of tool names?** `Nn` (a Set of "silent" tool names that suppress telemetry logging) is referenced but not enumerated in the extracted windows. Full tool listing is in `mcpPermissions-8PlHLvdl.js` where tools are registered.

4. **Does the bridge support multiplexing multiple harnesses per device?** `peer_connected`/`peer_disconnected` imply a single peer per bridge slot, but whether one device can have multiple active connections is unclear.

5. **Is the `session_scope` field documented anywhere?** It appears in `tool_call` and `tool_request` but its schema is not visible in the extracted code windows.

6. **CSP and `wss://` restriction**: the extension's CSP locks WebSocket to the two bridge domains. A fork for local use must either patch the CSP in `manifest.json` or use native messaging instead.
