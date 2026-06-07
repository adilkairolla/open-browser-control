# Tool Catalog and Schemas — Claude in Chrome v1.0.75

**Source files analyzed:**
- `assets/mcpPermissions-8PlHLvdl.js` (281 KB, minified — primary source)
- `assets/sidepanel-BL0NRfq2.js` (cross-reference for display names)
- `offscreen.js`, `assets/service-worker.ts-BsAUV92e.js` (supplemental)

---

## (a) Summary

**Total tools: 22** (20 browser-control tools + 2 meta/orchestration tools).

The extension exposes two overlapping tool sets depending on connection mode:

| Mode | Connection | Key difference |
|------|-----------|----------------|
| **MCP mode** | External MCP client over WebSocket bridge | Uses `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`; tab group is managed per-session |
| **Chat (sidepanel) mode** | Anthropic API directly | Uses `tabs_context` and `tabs_create` (non-MCP variants); includes `turn_answer_start` |

The complete MCP-mode tool array (`Cn` in the minified source) is:

```
read_page, find, form_input, computer, navigate, get_page_text,
tabs_context, tabs_context_mcp, tabs_create, tabs_create_mcp,
tabs_close_mcp, update_plan, upload_image, file_upload,
read_console_messages, read_network_requests, resize_window,
gif_creator, turn_answer_start, javascript_tool,
shortcuts_list, shortcuts_execute, browser_batch
```

The dominant execution mechanism is **Chrome Debugger Protocol (CDP)** via `chrome.debugger.sendCommand`, used for all pointer/keyboard/screenshot actions. Higher-level tools use `chrome.scripting.executeScript` (content-script injection) and native Chrome extension APIs (`chrome.tabs.*`, `chrome.windows.*`).

---

## (b) Catalog Table

| # | Tool name | Category | Execution mechanism |
|---|-----------|----------|---------------------|
| 1 | `computer` | Core input/output | CDP: `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Page.captureScreenshot` |
| 2 | `browser_batch` | Orchestration | Dispatches sequentially to other tools; no direct CDP |
| 3 | `navigate` | Navigation | `chrome.tabs.update` / `chrome.tabs.goBack` / `chrome.tabs.goForward`; optionally attaches CDP for `Page.enable` |
| 4 | `find` | DOM interaction | `chrome.scripting.executeScript` → injected NL element finder using `window.__claudeElementMap` |
| 5 | `read_page` | DOM inspection | `chrome.scripting.executeScript` → `window.__generateAccessibilityTree()` (injected content script) |
| 6 | `form_input` | DOM interaction | `chrome.scripting.executeScript` → content script sets form values via element refs |
| 7 | `get_page_text` | Content extraction | `chrome.scripting.executeScript` → article text extraction |
| 8 | `javascript_tool` | Scripting | CDP: `Runtime.evaluate` with `returnByValue:true, awaitPromise:true` |
| 9 | `read_console_messages` | Debugging | CDP: `Runtime.enable` + `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` event listener |
| 10 | `read_network_requests` | Debugging | CDP: `Network.enable` + `Network.requestWillBeSent` / `Network.responseReceived` / `Network.loadingFailed` |
| 11 | `tabs_context` | Tab management | `chrome.tabs.query` + `chrome.tabGroups.*` |
| 12 | `tabs_context_mcp` | Tab management (MCP) | Same as above, with MCP session scoping |
| 13 | `tabs_create` | Tab management | `chrome.tabs.create` + `chrome.tabs.group` |
| 14 | `tabs_create_mcp` | Tab management (MCP) | Same as above, scoped to MCP group |
| 15 | `tabs_close_mcp` | Tab management (MCP) | `chrome.tabs.remove` |
| 16 | `upload_image` | File I/O | `chrome.scripting.executeScript` — DataTransfer drag/drop or hidden file input injection |
| 17 | `file_upload` | File I/O | `chrome.scripting.executeScript` — sets files on `<input type="file">` via ref |
| 18 | `resize_window` | Window management | `chrome.windows.update` with `width`/`height` |
| 19 | `gif_creator` | Recording/export | `chrome.scripting.executeScript` + offscreen document GIF encoding |
| 20 | `shortcuts_list` | Meta | Chrome extension storage read |
| 21 | `shortcuts_execute` | Meta | `chrome.runtime.sendMessage` to open sidepanel |
| 22 | `update_plan` | Meta/permission | Returns `permission_required` result; user must approve before actions proceed |
| 23 | `turn_answer_start` | Meta (chat mode only) | No-op; signals model to emit text response |

---

## (c) Per-Tool Detail with Reconstructed JSON Schemas

### 1. `computer`

**Description:** "Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context first to get available tabs."

**Type:** Custom tool (not Anthropic's built-in `computer_use` type — uses `type:"object"` schema, not `type:"computer_20250124"`). The tool name `computer` is used but the schema is fully custom.

```json
{
  "name": "computer",
  "input_schema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": [
          "left_click", "right_click", "type", "screenshot", "wait",
          "scroll", "key", "left_click_drag", "double_click",
          "triple_click", "zoom", "scroll_to", "hover"
        ],
        "description": "The action to perform..."
      },
      "coordinate": {
        "type": "array",
        "items": { "type": "number" },
        "minItems": 2,
        "maxItems": 2,
        "description": "(x, y) in viewport pixels. Required for left_click, right_click, double_click, triple_click, scroll. For left_click_drag, this is the end position."
      },
      "text": {
        "type": "string",
        "description": "Text to type (for `type`) or space-separated keys (for `key`). Supports 'cmd+a', 'ctrl+a' etc."
      },
      "duration": {
        "type": "number",
        "minimum": 0,
        "maximum": "<configurable_max>",
        "description": "Seconds to wait. Required for `wait`."
      },
      "scroll_direction": {
        "type": "string",
        "enum": ["up", "down", "left", "right"],
        "description": "Required for `scroll`."
      },
      "scroll_amount": {
        "type": "number",
        "minimum": 1,
        "maximum": 10,
        "description": "Scroll wheel ticks. Default 3. Optional for `scroll`."
      },
      "start_coordinate": {
        "type": "array",
        "items": { "type": "number" },
        "minItems": 2,
        "maxItems": 2,
        "description": "(x, y) start position for `left_click_drag`."
      },
      "region": {
        "type": "array",
        "items": { "type": "number" },
        "minItems": 4,
        "maxItems": 4,
        "description": "(x0, y0, x1, y1) rectangle to capture for `zoom`. Required for `zoom`."
      },
      "repeat": {
        "type": "number",
        "minimum": 1,
        "maximum": 100,
        "description": "Number of times to repeat key sequence. Only for `key`. Default 1."
      },
      "ref": {
        "type": "string",
        "description": "Element reference ID from read_page or find (e.g. 'ref_1'). Required for `scroll_to`. Alternative to `coordinate` for clicks."
      },
      "modifiers": {
        "type": "string",
        "description": "Modifier keys: 'ctrl', 'shift', 'alt', 'cmd'/'meta', 'win'. Combinable with '+' (e.g. 'ctrl+shift'). Optional for click actions."
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to execute action on. Must be in current group."
      }
    },
    "required": ["action", "tabId"]
  }
}
```

**Action → permission mapping (internal):**
- `screenshot`, `scroll`, `scroll_to`, `zoom`, `hover` → `READ_PAGE_CONTENT` permission
- `left_click`, `right_click`, `double_click`, `triple_click`, `left_click_drag` → `CLICK` permission
- `type`, `key` → `TYPE` permission
- `wait` → no permission check

**Action → CDP command mapping:**
- `left_click` / `right_click` / `double_click` / `triple_click` → `Input.dispatchMouseEvent` (mousePressed, mouseReleased, mouseMoved)
- `left_click_drag` → `Input.dispatchMouseEvent` sequence (mousePressed + 5 intermediate mouseMoved + mouseReleased)
- `type` → `Input.dispatchKeyEvent` (for Enter/special keys) + `Input.insertText` (for regular characters)
- `key` → `Input.dispatchKeyEvent` keyDown/keyUp; reload keys (`cmd+r`, `F5` etc.) use `chrome.tabs.reload`
- `screenshot` → `Page.captureScreenshot` (JPEG format, resized in content script if needed)
- `zoom` → `Page.captureScreenshot` with `clip` parameter
- `scroll` → `Input.dispatchMouseEvent` (mouseWheel) via CDP; falls back to `window.scrollBy` via content script if tab is not active
- `scroll_to` → `chrome.scripting.executeScript` → `element.scrollIntoView()` using `window.__claudeElementMap`
- `hover` → `Input.dispatchMouseEvent` (mouseMoved only, no press/release)
- `wait` → `setTimeout`

---

### 2. `browser_batch`

**Description:** "Execute a sequence of browser tool calls in ONE round trip. Each item is {name, input} where input is exactly what you'd pass to that tool standalone. Actions execute SEQUENTIALLY (not in parallel) and stop on the first error."

```json
{
  "name": "browser_batch",
  "input_schema": {
    "type": "object",
    "properties": {
      "actions": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "description": "Tool name (e.g. computer, navigate, find, tabs_create). browser_batch cannot be nested."
            },
            "input": {
              "type": "object",
              "description": "That tool's input — same shape you'd pass when calling it directly."
            }
          },
          "required": ["name", "input"]
        },
        "description": "List of tool calls to execute sequentially. Example: [{\"name\":\"computer\",\"input\":{\"action\":\"left_click\",\"coordinate\":[100,200],\"tabId\":123}},{\"name\":\"computer\",\"input\":{\"action\":\"type\",\"text\":\"hello\",\"tabId\":123}},{\"name\":\"navigate\",\"input\":{\"url\":\"https://example.com\",\"tabId\":123}}]"
      }
    },
    "required": ["actions"]
  }
}
```

**Note:** The following tools are excluded from being callable inside `browser_batch` (they must be called standalone):
`navigate`, `tabs_context`, `tabs_context_mcp`, `upload_image`, `update_plan`, `gif_creator`, `resize_window`, `file_upload`, `tabs_create`, `tabs_create_mcp`.

Computer actions `key`, `type`, `wait`, `left_click_drag`, `left_click`, `scroll_to`, `hover`, `right_click`, `triple_click`, `double_click`, `scroll` are explicitly listed as "batchable" (the `ie` array).

---

### 3. `navigate`

**Description:** "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context first to get available tabs."

```json
{
  "name": "navigate",
  "input_schema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use 'forward' to go forward in history or 'back' to go back in history."
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to navigate. Must be a tab in the current group."
      },
      "force": {
        "type": "boolean",
        "description": "If the page shows a 'Leave site?' dialog because of unsaved changes, discard those changes and navigate anyway. Defaults to false."
      }
    },
    "required": ["url", "tabId"]
  }
}
```

**Execution:** `chrome.tabs.update(tabId, {url})` for forward navigation; `chrome.tabs.goBack()` / `chrome.tabs.goForward()` for history. Handles `beforeunload` dialogs via CDP `Page.handleJavaScriptDialog` / `Page.javascriptDialogOpening` events. Domain safety check blocks `category1`, `category2`, `category_org_blocked` domains.

---

### 4. `find`

**Description:** "Find elements on the page using natural language. Can search for elements by their purpose (e.g., 'search bar', 'login button') or by text content. Returns up to 20 matching elements with references that can be used with other tools."

```json
{
  "name": "find",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language description of what to find (e.g., 'search bar', 'add to cart button', 'product title containing organic')"
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to search in. Must be a tab in the current group."
      }
    },
    "required": ["query", "tabId"]
  }
}
```

**Execution:** `chrome.scripting.executeScript` injecting a function that queries `window.__claudeElementMap` (populated by the accessibility tree content script). Returns element refs like `"ref_1"`, `"ref_2"`, etc.

---

### 5. `read_page`

**Description:** "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Output is limited to 50000 characters."

```json
{
  "name": "read_page",
  "input_schema": {
    "type": "object",
    "properties": {
      "filter": {
        "type": "string",
        "enum": ["interactive", "all"],
        "description": "Filter elements: 'interactive' for buttons/links/inputs only, 'all' for all elements including non-visible ones (default: all)"
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to read from. Must be a tab in the current group."
      },
      "depth": {
        "type": "number",
        "description": "Maximum depth of the tree to traverse (default: 15). Use smaller depth if output is too large."
      },
      "ref_id": {
        "type": "string",
        "description": "Reference ID of a parent element to read. Will return the element and all its children."
      },
      "max_chars": {
        "type": "number",
        "description": "Maximum characters for output (default: 50000)."
      }
    },
    "required": ["tabId"]
  }
}
```

**Execution:** `chrome.scripting.executeScript` calls `window.__generateAccessibilityTree(filter, depth, max_chars, ref_id)` — a function injected by the `accessibility-tree.js` content script. Element refs are stored in `window.__claudeElementMap` as `WeakRef` objects. Viewport dimensions appended to output.

---

### 6. `form_input`

**Description:** "Set values in form elements using element reference ID from the read_page tool."

```json
{
  "name": "form_input",
  "input_schema": {
    "type": "object",
    "properties": {
      "ref": {
        "type": "string",
        "description": "Element reference ID from the read_page tool (e.g., 'ref_1', 'ref_2')"
      },
      "value": {
        "type": ["string", "boolean", "number"],
        "description": "The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use string/number."
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to set form value in."
      }
    },
    "required": ["ref", "value", "tabId"]
  }
}
```

**Execution:** `chrome.scripting.executeScript` uses `window.__claudeElementMap[ref]` to locate element, then sets `.value`, `.checked`, or dispatches appropriate events depending on element type.

---

### 7. `get_page_text`

**Description:** "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. Output limited to 50000 characters by default."

```json
{
  "name": "get_page_text",
  "input_schema": {
    "type": "object",
    "properties": {
      "tabId": {
        "type": "number",
        "description": "Tab ID to extract text from."
      },
      "max_chars": {
        "type": "number",
        "description": "Maximum characters for output (default: 50000)."
      }
    },
    "required": ["tabId"]
  }
}
```

**Execution:** `chrome.scripting.executeScript` — article text extraction heuristic (Mozilla Readability-style) runs in page context.

---

### 8. `javascript_tool`

**Description:** "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors."

```json
{
  "name": "javascript_tool",
  "input_schema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "description": "Must be set to 'javascript_exec'"
      },
      "text": {
        "type": "string",
        "description": "The JavaScript code to execute. Do NOT use 'return' statements — just write the expression (e.g., 'window.myData.value')."
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to execute the code in."
      }
    },
    "required": ["action", "text", "tabId"]
  }
}
```

**Execution:** CDP `Runtime.evaluate` with `returnByValue:true, awaitPromise:true`. Result is sanitized: JWT tokens, base64 blobs, hex credentials, cookie/query strings, and fields named `password`/`token`/`secret`/`api_key`/`auth`/`credential`/`private_key`/`access_key`/`bearer`/`oauth`/`session` are blocked/redacted.

---

### 9. `read_console_messages`

**Description:** "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Returns console messages from the current domain only."

```json
{
  "name": "read_console_messages",
  "input_schema": {
    "type": "object",
    "properties": {
      "tabId": {
        "type": "number",
        "description": "Tab ID to read console messages from."
      },
      "onlyErrors": {
        "type": "boolean",
        "description": "If true, only return error and exception messages. Default false."
      },
      "clear": {
        "type": "boolean",
        "description": "If true, clear the console messages after reading. Default false."
      },
      "pattern": {
        "type": "string",
        "description": "Regex pattern to filter console messages (e.g., 'error|warning'). Always provide a pattern."
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of messages to return. Default 100."
      }
    },
    "required": ["tabId"]
  }
}
```

**Execution:** CDP event listeners: `Runtime.enable`, `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`. Messages are stored in memory keyed by tab ID and domain; domain isolation is enforced.

---

### 10. `read_network_requests`

**Description:** "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Returns all network requests including cross-origin. Requests are cleared when the page navigates to a different domain."

```json
{
  "name": "read_network_requests",
  "input_schema": {
    "type": "object",
    "properties": {
      "tabId": {
        "type": "number",
        "description": "Tab ID to read network requests from."
      },
      "urlPattern": {
        "type": "string",
        "description": "Optional URL pattern to filter requests (e.g., '/api/' or 'example.com')."
      },
      "clear": {
        "type": "boolean",
        "description": "If true, clear the network requests after reading. Default false."
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of requests to return. Default 100."
      }
    },
    "required": ["tabId"]
  }
}
```

**Execution:** CDP: `Network.enable`, events `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFailed`. Stored in memory; cleared on domain change.

---

### 11. `tabs_context`

**Description:** "Get context information about all tabs in the current tab group."

```json
{
  "name": "tabs_context",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Execution:** `chrome.tabs.query` + `chrome.tabGroups.*`. Returns JSON with `availableTabs` array (tabId, title, url) and optional `tabGroupId`.

---

### 12. `tabs_context_mcp`

**Description:** "Get context information about the current MCP tab group. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab."

```json
{
  "name": "tabs_context_mcp",
  "input_schema": {
    "type": "object",
    "properties": {
      "createIfEmpty": {
        "type": "boolean",
        "description": "Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab. If a MCP tab group already exists, this parameter has no effect."
      }
    },
    "required": []
  }
}
```

**Execution:** Same chrome APIs as `tabs_context` but also manages MCP session scoping. Accepts `includePermissionState` and `checkUrls` internal parameters not exposed in the schema.

---

### 13. `tabs_create`

**Description:** "Creates a new empty tab in the current tab group."

```json
{
  "name": "tabs_create",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Execution:** `chrome.tabs.create({url: "chrome://newtab", active: false})` + `chrome.tabs.group`.

---

### 14. `tabs_create_mcp`

**Description:** "Creates a new empty tab in the MCP tab group."

```json
{
  "name": "tabs_create_mcp",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Execution:** Same as `tabs_create` but enforces MCP tab group membership.

---

### 15. `tabs_close_mcp`

**Description:** "Close a tab in the MCP tab group by its tab ID. Only tabs within the current session's group can be closed. If the closed tab is the last one in the group, Chrome auto-removes the group."

```json
{
  "name": "tabs_close_mcp",
  "input_schema": {
    "type": "object",
    "properties": {
      "tabId": {
        "type": "integer",
        "description": "The ID of the tab to close. Must be in this session's tab group — call tabs_context_mcp first to see valid IDs."
      }
    },
    "required": ["tabId"]
  }
}
```

**Execution:** `chrome.tabs.remove(tabId)`.

---

### 16. `upload_image`

**Description:** "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref — for targeting specific elements, especially hidden file inputs, (2) coordinate — for drag & drop to visible locations like Google Docs."

```json
{
  "name": "upload_image",
  "input_schema": {
    "type": "object",
    "properties": {
      "imageId": {
        "type": "string",
        "description": "ID of a previously captured screenshot (from the computer tool's screenshot action) or a user-uploaded image"
      },
      "ref": {
        "type": "string",
        "description": "Element reference ID from read_page or find tools (e.g., 'ref_1'). Use this for file inputs. Provide either ref or coordinate, not both."
      },
      "coordinate": {
        "type": "array",
        "items": { "type": "number" },
        "description": "Viewport coordinates [x, y] for drag & drop to a visible location. Provide either ref or coordinate, not both."
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID where the target element is located."
      },
      "filename": {
        "type": "string",
        "description": "Optional filename for the uploaded file (default: 'image.png')"
      }
    },
    "required": ["imageId", "tabId"]
  }
}
```

**Execution:** Image data is looked up from prior message history by `imageId`. Then `chrome.scripting.executeScript` injects a DataTransfer drop event (for coordinate mode) or directly assigns files to the `<input type="file">` via `window.__claudeElementMap` (for ref mode).

---

### 17. `file_upload`

**Description:** "Upload one or multiple files to a file input element on the page. Do not click on file upload buttons or file inputs — clicking opens a native file picker dialog that you cannot see or interact with. Instead, use read_page or find to locate the file input element, then use this tool with its ref."

```json
{
  "name": "file_upload",
  "input_schema": {
    "type": "object",
    "properties": {
      "files": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "data": { "type": "string", "description": "Base64-encoded file contents" },
            "name": { "type": "string", "description": "Filename shown to the page" },
            "mimeType": { "type": "string", "description": "MIME type of the file" }
          },
          "required": ["data", "name"]
        },
        "description": "Files to upload, as base64-encoded bytes."
      },
      "paths": {
        "type": "array",
        "items": { "type": "string" },
        "description": "DEPRECATED. Host filesystem paths are no longer accepted; pass file contents via `files` instead."
      },
      "ref": {
        "type": "string",
        "description": "Element reference ID of the file input from read_page or find tools."
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID where the file input is located."
      }
    },
    "required": ["ref", "tabId"]
  }
}
```

**Execution:** `chrome.scripting.executeScript` — creates `File` objects from base64 data and assigns them to the `<input type="file">` element via `window.__claudeElementMap[ref]`.

---

### 18. `resize_window`

**Description:** "Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes."

```json
{
  "name": "resize_window",
  "input_schema": {
    "type": "object",
    "properties": {
      "width": {
        "type": "number",
        "description": "Target window width in pixels"
      },
      "height": {
        "type": "number",
        "description": "Target window height in pixels"
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to get the window for."
      }
    },
    "required": ["width", "height", "tabId"]
  }
}
```

**Execution:** `chrome.tabs.get(tabId)` to find window, then `chrome.windows.update(windowId, {width, height})`.

---

### 19. `gif_creator`

**Description:** "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays."

```json
{
  "name": "gif_creator",
  "input_schema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["start_recording", "stop_recording", "export", "clear"],
        "description": "Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop but keep frames), 'export' (generate and export GIF), 'clear' (discard frames)"
      },
      "tabId": {
        "type": "number",
        "description": "Tab ID to identify which tab group this operation applies to"
      },
      "coordinate": {
        "type": "array",
        "items": { "type": "number" },
        "description": "Viewport coordinates [x, y] for drag & drop upload. Required for 'export' action unless 'download' is true."
      },
      "download": {
        "type": "boolean",
        "description": "If true, download the GIF instead of drag/drop upload. For 'export' action only."
      },
      "filename": {
        "type": "string",
        "description": "Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only."
      },
      "options": {
        "type": "object",
        "description": "Optional GIF enhancement options for 'export' action.",
        "properties": {
          "showClickIndicators": {
            "type": "boolean",
            "description": "Show orange circles at click locations (default: true)"
          },
          "showDragPaths": {
            "type": "boolean",
            "description": "Show red arrows for drag actions (default: true)"
          },
          "showActionLabels": {
            "type": "boolean",
            "description": "Show black labels describing actions (default: true)"
          },
          "showProgressBar": {
            "type": "boolean",
            "description": "Show orange progress bar at bottom (default: true)"
          },
          "showWatermark": {
            "type": "boolean",
            "description": "Show Claude logo watermark (default: true)"
          },
          "quality": {
            "type": "number",
            "description": "GIF compression quality, 1-30 (lower = better quality, slower encoding). Default: 10"
          }
        }
      }
    },
    "required": ["action", "tabId"]
  }
}
```

**Execution:** Frames are captured by intercepting `computer` tool calls (clicks, navigates) in `fe()`. Screenshots are taken via `Page.captureScreenshot`. Frames are stored in memory (max 50 per group). On `export`, the offscreen document (`offscreen.html`) performs GIF encoding using `gif.js`. Export can use `chrome.downloads.download` or simulate a drag-drop onto the page.

---

### 20. `shortcuts_list`

**Description:** "List all available shortcuts and workflows. Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow."

```json
{
  "name": "shortcuts_list",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Execution:** Reads from extension storage via an internal `getAllPrompts()` function.

---

### 21. `shortcuts_execute`

**Description:** "Execute a shortcut or workflow by running it in a new sidepanel window using the current tab. Use shortcuts_list first to see available shortcuts. This starts the execution and returns immediately."

```json
{
  "name": "shortcuts_execute",
  "input_schema": {
    "type": "object",
    "properties": {
      "shortcutId": {
        "type": "string",
        "description": "The ID of the shortcut to execute"
      },
      "command": {
        "type": "string",
        "description": "The command name of the shortcut to execute (e.g., 'debug', 'summarize'). Do not include the leading slash."
      }
    },
    "required": []
  }
}
```

**Execution:** Looks up shortcut by `shortcutId` or `command`, then calls an internal `Tn()` function that opens a new sidepanel window and passes the shortcut prompt as `[[shortcut:<id>:<command>]]`.

---

### 22. `update_plan` (conditional — "follow_a_plan" mode only)

**Description:** "Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach. Once approved, you can proceed with actions on the approved domains without additional permission prompts."

```json
{
  "name": "update_plan",
  "input_schema": {
    "type": "object",
    "properties": {
      "domains": {
        "type": "array",
        "items": { "type": "string" },
        "description": "List of domains you will visit (e.g., ['github.com', 'stackoverflow.com']). These domains will be approved for the session when the user accepts the plan."
      },
      "approach": {
        "type": "array",
        "items": { "type": "string" },
        "description": "High-level description of what you will do. Focus on outcomes and key actions, not implementation details. Be concise — aim for 3-7 items."
      }
    },
    "required": ["domains", "approach"]
  }
}
```

**Execution:** Returns a `{type:"permission_required", tool:"PLAN_APPROVAL"}` result — not a real side-effect; causes the UI to show the plan to the user. If user approves, the domains are added to the session allowlist and the model continues. If rejected, the model receives `"Plan rejected by user."`.

---

### 23. `turn_answer_start` (chat/sidepanel mode only)

**Description:** "Call this immediately before your text response to the user for this turn. Required every turn — whether or not you made tool calls. After calling, write your response. No more tools after this."

```json
{
  "name": "turn_answer_start",
  "input_schema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Execution:** No-op — immediately returns `{output: "Proceed with your response."}`. This is a signaling mechanism to demarcate the boundary between tool use and text response in the chat UI.

---

## (d) Execution Mechanism Mapping

### Chrome Debugger Protocol (CDP) — via `chrome.debugger.sendCommand`

Used for all low-level browser interaction. The debugger is attached on-demand to a tab.

| CDP Command | Used by |
|-------------|---------|
| `Input.dispatchMouseEvent` | `computer` (left_click, right_click, double_click, triple_click, left_click_drag, scroll, hover) |
| `Input.dispatchKeyEvent` | `computer` (key, type for special keys) |
| `Input.insertText` | `computer` (type for regular text) |
| `Page.captureScreenshot` | `computer` (screenshot, zoom) |
| `Page.enable` | `navigate` (to listen for navigation events) |
| `Page.frameNavigated` | Internal navigation tracking |
| `Page.handleJavaScriptDialog` | `navigate` (beforeunload handling) |
| `Page.javascriptDialogOpening` | `navigate` (detect leave-site dialogs) |
| `Runtime.evaluate` | `javascript_tool` |
| `Runtime.enable` | `read_console_messages` setup |
| `Runtime.consoleAPICalled` | `read_console_messages` event |
| `Runtime.exceptionThrown` | `read_console_messages` event |
| `Network.enable` | `read_network_requests` setup |
| `Network.requestWillBeSent` | `read_network_requests` event |
| `Network.responseReceived` | `read_network_requests` event |
| `Network.loadingFailed` | `read_network_requests` event |
| `Network.disable` | `read_network_requests` cleanup |

### Content Script Injection — via `chrome.scripting.executeScript`

Used for DOM inspection and element interaction:

| Tool | What is injected |
|------|-----------------|
| `read_page` | Calls `window.__generateAccessibilityTree()` — provided by `accessibility-tree.js` content script |
| `find` | Queries `window.__claudeElementMap` for matching elements |
| `form_input` | Sets form values via `window.__claudeElementMap[ref]` |
| `get_page_text` | Article text extraction inline function |
| `computer` (scroll_to, hover via ref, scroll fallback) | `element.scrollIntoView()`, `window.scrollBy()`, coordinate lookup |
| `upload_image` (drag-drop mode) | Creates and dispatches `DragEvent` with DataTransfer |
| `file_upload` | Assigns `FileList` to `<input type="file">` |
| `computer` (scroll wheel fallback) | `window.scrollBy()` when tab is not active |

### Chrome Extension APIs

| API | Used by |
|-----|---------|
| `chrome.tabs.update` | `navigate` |
| `chrome.tabs.goBack` / `chrome.tabs.goForward` | `navigate` (history) |
| `chrome.tabs.reload` | `computer` (key action: F5/cmd+r) |
| `chrome.tabs.create` | `tabs_create`, `tabs_create_mcp` |
| `chrome.tabs.remove` | `tabs_close_mcp` |
| `chrome.tabs.query` | `tabs_context`, `tabs_context_mcp` |
| `chrome.tabs.get` | All tools that need tab info |
| `chrome.tabs.group` / `chrome.tabs.ungroup` | Tab group management |
| `chrome.tabGroups.update` / `chrome.tabGroups.get` | Tab group color/name |
| `chrome.windows.update` | `resize_window` |
| `chrome.windows.create` | MCP group creation |
| `chrome.downloads.download` | `gif_creator` (download mode) |
| `chrome.storage.local` | Shortcuts, settings, tab state |
| `chrome.offscreen.createDocument` | GIF encoding, service worker keepalive |

### Coordinate system note

Screenshot coordinates from `Page.captureScreenshot` may differ from viewport coordinates if the device pixel ratio > 1 or if the screenshot was downscaled. The extension stores a `ScreenshotContext` (viewportWidth, viewportHeight, screenshotWidth, screenshotHeight) and the `De()` function scales coordinates:
```
viewportX = round(screenshotX * viewportWidth / screenshotWidth)
viewportY = round(screenshotY * viewportHeight / screenshotHeight)
```
This scaling is applied automatically when `coordinate` is passed to click/drag/scroll actions.

---

## (e) Claude/Anthropic-Specific vs Generic-Reusable Notes

### Anthropic/Claude-specific (would need to be replaced or mocked):

1. **`turn_answer_start`** — A signaling tool unique to the Anthropic Claude API's streaming format in the sidepanel UI. A generic rebuild would not need this; the model can respond freely.

2. **`update_plan` / "follow_a_plan" mode** — Domain allow-listing flow is tied to the Claude-in-Chrome UI permission system. However, the underlying schema (domains + approach arrays) and pattern are generic and reusable.

3. **`showWatermark` option in `gif_creator`** — Default `true`, adds "Claude logo watermark." Trivially disabled (`showWatermark: false`).

4. **`shortcuts_list` / `shortcuts_execute`** — Tied to Claude-in-Chrome's internal shortcut/workflow store. Not meaningful for a generic rebuild unless you implement a similar concept.

5. **API base URL** — Points to `bridge.claudeusercontent.com` (WebSocket bridge). A generic rebuild would use a different transport.

6. **Category/domain safety checks** — "category1", "category2", "category_org_blocked" refer to Anthropic's internal domain classification service (called via `N.getCategory(url)`). A generic rebuild would need its own allowlist/blocklist mechanism or can skip it.

7. **Model selection** — References Anthropic model IDs internally, but these are abstracted away from the tool layer.

### Generic / Directly Reusable (the entire tool layer minus the above):

- All 13 core browser-control tools: `computer`, `navigate`, `find`, `read_page`, `form_input`, `get_page_text`, `javascript_tool`, `read_console_messages`, `read_network_requests`, `tabs_*`, `upload_image`, `file_upload`, `resize_window`, `gif_creator`, `browser_batch`
- The CDP command set and content-script injection patterns
- The `window.__claudeElementMap` / `window.__generateAccessibilityTree` content script interface
- The element reference system (`ref_1`, `ref_2`, ...) using `WeakRef`
- The `tabId`-based tool context model

---

## (f) Open Questions and Low-Confidence Items

1. **`find` element-finding algorithm**: The tool says it uses "natural language" to find elements, but it operates via `window.__claudeElementMap`. It's unclear whether the NL matching happens client-side (using the accessibility tree text) or via a server-side call. Low confidence — could involve a secondary model call.

2. **`browser_batch` schema tool name**: In the source, `oe` is the variable holding `"browser_batch"` and `we` holds the description. These are confirmed. However, the MCP-exposed name may differ from the chat-mode name; both appear to use `"browser_batch"`.

3. **`computer` tool type**: The tool uses a regular `input_schema` object, NOT Anthropic's special `type:"computer_20250124"` computer-use API type. This is a deliberate custom implementation. This is confirmed — only `turn_answer_start` and `update_plan` use `type:"custom"` in their `toAnthropicSchema()` return; all others return plain `input_schema` objects.

4. **`scroll` via CDP scrollWheel**: The extension tries `Input.dispatchMouseEvent` with `type:"mouseWheel"` for active tabs, with `deltaX`/`deltaY` computed as `ticks * 100px`. If this fails or the tab is not active, it falls back to `window.scrollBy` via content script. Exact behavior for inactive tabs is confirmed from the source.

5. **`screenshot` format**: Always JPEG (for compression), downscaled if needed. The `MAX_BASE64_CHARS` limit controls whether downscaling occurs. The `zoom` action uses PNG. These constants are referenced via `z.MAX_BASE64_CHARS`, `z.JPEG_QUALITY_STEP`, `z.MIN_JPEG_QUALITY` — exact values are not recovered from the minified source without more extraction.

6. **`tabs_context` vs `tabs_context_mcp` in tool list**: Both appear in the MCP tool array `Cn`. This suggests that in MCP mode, both are available, but the model is instructed to prefer `tabs_context_mcp`. The chat-mode handler `Dn` also has both, but `tabs_context_mcp` is listed in `Mn` (a special set) requiring no tab context to call.

7. **`find` tool returning element references**: The source confirms it returns refs via `window.__claudeElementMap`, but the NL-to-element matching heuristic in the content script (in `accessibility-tree.js-CCweLwU2.js`) was not directly analyzed here — only referenced.
