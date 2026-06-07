# Claude in Chrome v1.0.75 — Feature & UI Inventory

*Evidence base: i18n/en-US.json (read fully), manifest.json, HTML pages (sidepanel, options, pairing, blocked, gif_viewer, offscreen), offscreen.js, gif_viewer.js, asset filenames, and targeted grep across minified JS bundles (sidepanel-BL0NRfq2.js, options-DxcKhBKM.js, service-worker.ts-BsAUV92e.js, startRecording-DT2Ni7PN.js, PairingPrompt-w3HeUd5o.js, onboarding-prompts-CWLEgoC0.js).*

---

## (a) Summary

Claude in Chrome is a browser extension that embeds a full chat interface with Claude (claude.ai) into a browser side panel. Its headline capability is **autonomous browser control**: Claude can navigate pages, click, type, scroll, drag, execute JavaScript, read page content/accessibility trees, capture screenshots, and inspect network/console state — all while the user watches from the side panel.

On top of browser automation the extension adds: **workflow recording** (user demos a task with optional voice narration → Claude learns and repeats it), **scheduled tasks** (shortcuts run on cron-like schedules), **GIF export** (conversation screenshots become an annotated animated GIF), a rich **content rendering** layer (Mermaid diagrams, KaTeX math, Cytoscape/Wardley graphs), **Google Workspace connectors** (Docs, Sheets, Slides, Gmail, Calendar via MCP), and an experimental **Cowork/filesystem** mode.

The extension requires a **paid Claude plan** and authenticates via claude.ai. An "API Key Mode" lets advanced users bypass the claude.ai login and supply an Anthropic API key directly.

---

## (b) UI Surfaces

| Surface | File | Purpose |
|---|---|---|
| **Side Panel** | sidepanel.html + sidepanel-BL0NRfq2.js | Main chat UI; lives in Chrome's side panel slot (Ctrl+E / Cmd+E to toggle). Full conversation interface, tool execution display, workflow recording controls, artifact rendering. |
| **Options Page** | options.html + options-DxcKhBKM.js | Settings: Keyboard shortcut, Permissions, Shortcuts, Notifications, Microphone, Scheduled tasks (and hidden Debug/API sections). |
| **Pairing Page** | pairing.html + PairingPrompt-w3HeUd5o.js | Shown when an external client (Claude Desktop, Claude Code) connects to the extension's native-messaging bridge. User names the browser and accepts/ignores the pairing request. |
| **Blocked Page** | blocked.html | Full-page overlay shown when Claude navigates to a site that is org-blocked or unsafe: "The content on this page isn't available when Claude is active for safety reasons." |
| **GIF Viewer** | gif_viewer.html + gif_viewer.js | Dark-background page that displays an exported animated GIF from `chrome.storage.local`, then offers download-on-click. Data expires after 5 minutes. |
| **Offscreen Document** | offscreen.html + offscreen.js | Hidden Chrome Offscreen Document. Handles: (1) audio playback of `notification.mp3`, (2) GIF generation (gif.js + gif.worker.js). Receives `OFFSCREEN_PLAY_SOUND`, `GENERATE_GIF`, `REVOKE_BLOB_URL` messages from the service worker. |
| **Content Overlays** | agent-visual-indicator.js-DVYDybPo.js | Injected into every page. Shows a cursor/phantom animation when Claude is actively controlling a tab, and a static indicator when Claude is in a tab group. |
| **claude.ai Content Script** | content-script.ts-zjy42LA0.js + onboarding-prompts-CWLEgoC0.js | Runs only on claude.ai. Intercepts `#claude-onboarding-button` clicks; exposes canned example prompts for onboarding. |
| **Accessibility Tree Injector** | accessibility-tree.js-CCweLwU2.js | Injected into all frames at document_start. Builds structured ARIA role/label tree used by the agent to understand page semantics without screenshot parsing. |

---

## (c) Full Feature List

### 1. Core Chat

| Feature | Description | Evidence |
|---|---|---|
| Side-panel chat | Full Claude chat embedded in Chrome's side panel | `sidepanel.html`; "How can I help you today?"; Ctrl+E / Cmd+E |
| Model selection | Dropdown to switch Claude model in-conversation | "Model selector, {model} selected"; "Select model" |
| Effort setting | Control extended thinking depth | "Effort"; "Effort is not available for the selected model." |
| Conversation compaction | Auto-summarises long chats to continue within context limits | "Compacting our conversation so we can keep chatting..."; "Conversation compacted"; "Clear history and keep summary" |
| Clear chat | Wipe conversation | "Clear chat" |
| Share conversation | Generate shareable link | "Share the conversation"; "Share Conversation"; "Copy link" |
| Message feedback | Thumbs up/down + typed reason | "Give positive feedback"; "What was unsatisfying about this response?" |
| File upload | Attach images and documents to messages | "Upload files"; "Drop files here to add to chat"; "Add an image" |
| File encoding selector | Choose encoding for text files (UTF-8, Latin-1, Shift_JIS, EUC-KR, etc.) | "Select file encoding"; "Default (UTF-8)"; "Japanese (Shift_JIS)" |
| Paid plan required | Extension requires claude.ai paid subscription | "Claude in Chrome requires a paid plan" |
| Login / logout | Sign in via claude.ai; log out from options page | "Login"; "Log out"; "Sign in again to continue using Claude in Chrome." |
| API Key Mode | Alternative auth: enter Anthropic API key directly | "API Key Mode"; "Anthropic API Key"; "Save API Key"; "Enter your Anthropic API key" |
| Language setting | Change extension UI language (restarts chat) | "Language"; "Change language"; "Changing the language will start a new chat." |

### 2. Browser Automation / Agent Mode

| Feature | Description | Evidence |
|---|---|---|
| Browse, click, type | Core agent actions on any page | "Browse, click, and type"; "Browser automation" |
| Navigation | Claude navigates to URLs | "Navigate to {url}"; `manifest.json` host_permissions `<all_urls>` |
| Click variants | Click, double-click, triple-click, right-click | "Click: "{target}""; "Double-click"; "Triple-click"; "Right-click" |
| Typing | Type text into inputs | "Type: "{text}""; "Type text" |
| Scroll | Scroll page/element | "Scroll"; "Scroll to element"; "Scroll to: "{text}"" |
| Drag | Drag elements | "Drag"; "Drag Path:"; "Screenshot with drag path" |
| Hover | Hover over elements | "Hover" |
| Press key / hold key | Keyboard event simulation | "Press key: {keys}"; "Hold key: {keys}"; "Press {count} keys: {summary}" |
| Execute JavaScript | Run arbitrary JS in page context | "Execute JavaScript"; `"javascript_tool"` |
| Set form value | Fill form fields programmatically | "Set form value"; "Set input to "{value}"" |
| Find element | Locate element by selector/text | "Find element"; `"find"` |
| Read page (interactive) | Read interactive DOM state | "Read page (interactive)"; `"read_page"` |
| Read page (all) | Read full page text/structure | "Read page (all)"; "Extract page text"; `"extract_page_text"` |
| Read console messages | Capture JS console output | "Read console messages"; `"read_console_messages"` |
| Read network requests | Inspect HTTP traffic | "Read network requests"; `"read_network_requests"` |
| Screenshot | Capture visible tab | "Take a screenshot"; `"take_screenshot"` |
| Desktop screenshots | Capture full desktop (not just tab) | "Desktop screenshots"; "Desktop screenshot" |
| Resize window | Resize the browser window | "Resize window"; `"resize_window"` |
| Get tabs | Retrieve tab list | "Get tabs"; `"get_tabs"`; `"PytICQxIDI"` |
| Create new tab | Open a new browser tab | "Create new tab"; `"create_tab"` |
| Tab group access | Read URLs/context of all tabs in the current tab group | "Claude has tab group access"; "If Claude is open in a tab group, it can access the URL, context and information of all the tabs in that group."; `tabGroups` permission |
| Switch browser | Switch between connected browsers (for pairing) | "Switching browser"; "switch_browser"; "select_browser"; "list_connected_browsers" |
| Ran terminal | Execute terminal/shell commands (Cowork mode) | "Ran terminal"; `"3HqwPnSzes"` |
| Run sub-agent | Spawn a subordinate agent for a subtask | "Running subagent"; "Ran an agent"; "Ran {count} agents" |
| Agent visual indicator | Animated cursor overlay shown on pages Claude controls | `agent-visual-indicator.js-DVYDybPo.js` |
| Accessibility tree | Structured semantic page representation sent to Claude | `accessibility-tree.js-CCweLwU2.js` injected all frames |
| Web search | Claude searches the web | "Web search"; "Searching the web"; "Searched the web" |
| Web fetch | Claude fetches arbitrary URLs | "Web fetch"; "Fetch {url}"; "Fetching from {hostname}" |
| Plan mode | Claude drafts a plan for approval before acting | "Claude's plan"; "Approve plan"; "Plan rejected"; "Drafting plan..."; "Creating plan..."; "Update plan"; "Follow the plan" |
| Ask before acting | Permission mode requiring per-action approval | "Ask before acting"; "Your permission is needed to continue"; "Claude wants to {toolAction}:" |
| Act without asking | Autonomous mode: Claude acts without per-action prompts | "Act without asking"; "Claude takes actions without asking for permission" |
| Skip all permissions | Global "permissionless" mode — highest risk | "Skip all permissions across the internet?"; "HIGH RISK: Claude can take most actions on the internet now." |
| Per-site permissions | Grant always-allow or ask-each-time per domain | "Always allow actions on this site"; "This site requires permission for each action."; "Your approved sites" |
| Domain transition pause | Claude pauses when navigating between domains | "Claude paused due to a navigation from {fromDomain} to {toDomain}"; "Domain Transitions" |
| Blocked site handling | Graceful stop when landing on org-blocked or unsafe site | blocked.html; "Claude landed on a blocked site and can't complete your request." |
| Extension conflict detection | Warns if another extension (e.g., ad blockers) interferes | "Another extension you're using is preventing Claude in Chrome from operating. Turn off extensions such as {extensionName}" |
| Prompt injection warning | Warns about malicious page instructions that could hijack agent | "Malicious actors can hide instructions in websites, emails, and documents..."; "Malicious code buried in sites..." |

### 3. Workflow Recording ("Teach Claude")

| Feature | Description | Evidence |
|---|---|---|
| Record workflow | User demonstrates a task step-by-step; Claude learns to reproduce it | "Record workflow"; "Teach Claude your workflow"; "Click through your task to record each step"; `record-workflow-hero-CjmRJsCN.png`; `startRecording-DT2Ni7PN.js` |
| Voice narration | User speaks during recording; browser speech-to-text captures intent | "Enable your microphone to narrate as you demonstrate the workflow. Claude will learn the process and repeat it for you."; "Voice narration active"; "Listening..." |
| Microphone permission | Requests mic access for voice narration | "Enable microphone access to use your browser's speech-to-text functionality for voice narration during workflow recording" |
| Save as shortcut | Saved workflow becomes a reusable / slash-command shortcut | "Save as shortcut"; "Save as Teach Claude" |
| Steps playback | Recorded steps displayed in collapsible view | "Steps ({count})"; "Click through your task to record each step" |
| rrweb DOM recording | The startRecording JS uses rrweb-style DOM serialisation (mutation observers, CSS, shadow DOM, media tracking) to capture the session | `startRecording-DT2Ni7PN.js` contains rrweb serialiser code |

### 4. Shortcuts & Scheduled Tasks

| Feature | Description | Evidence |
|---|---|---|
| Shortcuts | Named prompt templates invoked with `/` in chat | "Shortcuts"; "Type / for commands"; "Shortcuts make it easy to send instructions to Claude." |
| Create shortcut | Add a new named shortcut with name + prompt | "Create shortcut"; "Create your first shortcut to get started" |
| Edit / delete shortcut | Manage existing shortcuts | "Edit shortcut"; "Delete"; "Shortcut updated"; "Shortcut deleted" |
| Shortcut AI generation | Claude auto-generates a shortcut from a description | "Generating shortcut..." |
| Schedule task | Run a shortcut on a recurring schedule | "Schedule task"; "Create Scheduled Task"; "Create Scheduled Task"; "Scheduled" |
| Schedule frequencies | Once, Daily, Weekly, Monthly, Annually | "Once"; "Daily"; "Weekly"; "Monthly"; "Annually" |
| Scheduled via Chrome Alarms | Scheduled tasks use `chrome.alarms` API | `alarms` permission in manifest; "Test Scheduled Task (via Alarm in 1s)" |
| Convert to task | Convert a chat message into a repeatable task | "Convert to task" |
| Notify me | Get notification when a scheduled task completes | "Notify me"; "Task completion notifications" |

### 5. GIF Export

| Feature | Description | Evidence |
|---|---|---|
| Create GIF | Export conversation + action screenshots as animated GIF + JSON | "Create GIF"; "Animated GIF with action indicators" |
| Export includes | All messages + JSON conversation file | "This will export your conversation as a JSON file and an animated GIF." |
| Action overlays | Click, scroll, type, drag indicators drawn on GIF frames | `offscreen.js`: annotates frames with action type overlays (orange cursor for clicks, red overlay for drags) |
| GIF viewer | Separate HTML page shows the exported GIF; click to download | `gif_viewer.html`; gif_viewer.js: loads from `chrome.storage.local`, expires in 5 min |
| gif.js library | Client-side GIF encoding runs in offscreen document | `gif.js`, `gif.worker.js` |

### 6. Rich Content Rendering

| Feature | Description | Evidence |
|---|---|---|
| Mermaid diagrams | All standard Mermaid diagram types rendered in chat | 20+ diagram chunk files: `flowDiagram`, `sequenceDiagram`, `classDiagram`, `erDiagram`, `ganttDiagram`, `pieDiagram`, `stateDiagram`, `gitGraphDiagram`, `mindmap`, `timeline`, `sankeyDiagram`, `quadrantDiagram`, `vennDiagram`, `xychartDiagram`, `ishikawaDiagram`, `journeyDiagram`, `requirementDiagram`, `c4Diagram`, `architectureDiagram`, `blockDiagram`, `kanban`; "Mermaid diagram" UI string |
| Wardley maps | Wardley diagram renderer | `wardley-RL74JXVD-DzEvf6ni.js`; `wardleyDiagram-NUSXRM2D-C1WuTnNg.js` |
| Cytoscape graphs | Network/graph diagrams | `cytoscape.esm-D0rpECfm.js`; `cose-bilkent-S5V4N54A-Jg7BvaAN.js`; `dagre-KV5264BT-D-dZKqLS.js` |
| KaTeX math | LaTeX math rendering | `katex-CYzaLkmr.js` + multiple KaTeX font files |
| Interactive artifacts | Claude-generated runnable HTML/JS apps | "Interactive artifact"; "Drafting artifact..."; "Open artifact"; "Customize Artifact" |
| Artifact sharing | Share artifacts publicly; remix others' artifacts | "artifact.share_button_clicked"; "artifact.public.remix"; "Take this Artifact with you in a new chat" |
| Artifact reporting | Report inappropriate artifacts | "Report Artifact"; "9W9AYgC9Qk" |
| Code blocks | Syntax-highlighted code with copy button; size-based syntax-highlighting toggle | "{language} code"; "Syntax highlighting has been disabled due to code size." |
| CSV analysis | Analyze CSVs with code execution | "Claude can analyze CSVs with the Analysis tool." |

### 7. Connectors (Google Workspace + Others)

| Feature | Description | Evidence |
|---|---|---|
| Google Docs | Structured API tools for editing Docs | `google_docs-DG_B83rN.svg`; "Google Workspace API"; MCP endpoint `https://drivemcp.googleapis.com/mcp` |
| Google Sheets | Structured API tools for Sheets | `sheets-BFqvs63-.svg`; `https://mcp-server-gdrive-*.run.app` |
| Google Slides | Structured API tools for Slides | `slides-CCmiWPex.svg` |
| Gmail | Structured API tools for email | `gmail.svg`; `https://gmail.mcp.claude.com/mcp` |
| Google Calendar | Structured API tools for scheduling | `calendar.svg`; `https://gcal.mcp.claude.com/mcp`; `https://calendarmcp.googleapis.com/mcp/v1` |
| Google Drive | Search/access Drive files | "Searched Drive"; `https://drivemcp.googleapis.com/mcp/v1` |
| Microsoft 365 | Connector for Microsoft suite | `outlook-C3gQPWzw.svg`; `https://microsoft365.mcp.claude.com/mcp` |
| Slack | Slack connector | `slack-CUVwRKoB.svg`; `https://slack.mcp.ant.dev/sse` |
| Manage connectors | UI to add/remove/configure connectors | "Manage connectors"; "Connectors"; "This connector has known issues" |
| Google OAuth | Auth flow for Workspace integration | "Connect your Google account for faster edits in Sheets, Docs, Slides, Gmail, and Calendar."; "check_and_refresh_oauth" in service worker |
| Google Workspace API toggle | Enable/disable structured API tools globally | "Enable to use structured API tools for Google Workspace"; "Enable structured API tools for Google Docs, Sheets, Slides, Gmail, and Calendar" |

### 8. Cowork / Filesystem Mode

| Feature | Description | Evidence |
|---|---|---|
| Cowork mode | Experimental mode: Claude works in local folders, not just browser tabs | "Go beyond the browser with Cowork"; "Claude can now work in your folders, not just your browser tabs." |
| File explorer | Browse/open local files; preview; export to GDrive | `cowork.file_explorer.*` analytics events; `cowork.file.gdrive_export.*` |
| Global instructions | Persistent system-level instructions across chats | "Global instructions"; `cowork.global_instruction.*` |
| Folder instructions | Per-folder contextual instructions | "Folder instructions" |
| Memory editor | Edit Claude's persistent memory | `cowork.memory_editor.*` events |
| Code session | Launch coding session from Cowork | `cowork.launch_code_session` |
| Native messaging (Desktop/Claude Code) | Connects to Claude Desktop or Claude Code via native-messaging host | `"com.anthropic.claude_browser_extension"`; `"com.anthropic.claude_code_browser_extension"`; `nativeMessaging` permission; pairing.html |
| Bridge connection | WebSocket bridge to claude.ai platform | CSP `wss://bridge.claudeusercontent.com`; `wss://bridge-staging.claudeusercontent.com` |

### 9. Pairing / Multi-Browser

| Feature | Description | Evidence |
|---|---|---|
| Browser pairing | External client (Claude Desktop / Claude Code) requests to connect to this browser | pairing.html; "{clientLabel} wants to connect"; "Name this browser so you can identify it later." |
| Browser naming | User assigns a friendly name to distinguish browsers | "e.g., 'Work laptop', 'Personal Chrome'" |
| Switching browser | Agent can switch between paired browsers | "switch_browser"; "Switching browser" |

### 10. Notifications & Sound

| Feature | Description | Evidence |
|---|---|---|
| Task completion notification | Chrome notification when background task finishes | "Task completion notifications"; "You'll receive notifications when tasks finish"; `notifications` permission |
| Notification sound | Plays `notification.mp3` via offscreen AudioContext | `sounds/notification.mp3`; offscreen.js plays via Web Audio API |
| Notification opt-in prompt | Prompts user to set notification preference | "You haven't set your notification preference yet"; "Get notified when tasks complete or need your input" |
| Notifications off state | Explicit opt-out | "Notifications are turned off" |

### 11. Onboarding

| Feature | Description | Evidence |
|---|---|---|
| 3-step onboarding | Multi-step intro: (1) browser control beta warning, (2) tab group access, (3) shortcuts intro | "Step {currentStep} of {totalCount}"; "Claude has tab group access"; "Use shortcuts to save time"; `IvNiHZimcV: "Onboarding illustration"` |
| Pin extension prompt | Encourages user to pin the extension for quick access | "Pin Claude for quick access"; "Click the pin icon in the top right corner of the extension window" |
| Example prompts | Canned task examples injected on claude.ai | `onboarding-prompts-CWLEgoC0.js`: Zillow apartment search, Google Calendar scheduling, Gmail unsubscribe, DoorDash ordering, Salesforce lead conversion |
| Practice challenges | Interactive onboarding tasks (form fill, equipment selection) | "challenge-form"; "challenge-equipment" — canned agent prompts |

### 12. Safety / Moderation

| Feature | Description | Evidence |
|---|---|---|
| Org URL blocking | Managed policy blocks specific URL patterns | `managed_schema.json`: `blockedUrlPatterns`; `blocked.html` |
| Org login enforcement | Force specific Anthropic org account | `managed_schema.json`: `forceLoginOrgUUID`; "Your organization requires you to sign in with a specific account." |
| Safety filter fallback | If primary model's safety filter triggers, falls back to a different model | "{currentModelName}'s safety filters flagged this chat...Continue your chat with {fallbackDisplayName}" |
| Artifact reporting | Report harmful artifacts to Anthropic | "Report Artifact"; categories: copyright, fraud, illegal goods, defamation, sexual, child safety, violence/hate, trademark |
| Prompt injection warning | Educates user about prompt injection in agent mode | "Malicious actors can hide instructions in websites..." |
| Purchase/account guardrails | Agent will not purchase items, create accounts, or bypass captchas without explicit input | "Claude will not purchase items, create accounts, or bypass captchas without input." |
| Content report opt-out | Opt out of report data being used for model training | "Opt out of training on this report" |
| URL hash check | Extension checks URL hashes against Anthropic blocklist | `/api/web/url_hash_check/browser_extension` endpoint in `mcpPermissions` |

### 13. Developer / Debug Features

| Feature | Description | Evidence |
|---|---|---|
| Debug Settings panel | Hidden in-app developer tools | "Debug Settings"; "(Ant-only) Debug Settings"; "Dev Testing" |
| Show performance trace pill | Download JSONL traces for waterfall rendering | "Show performance trace pill"; "Shows a download pill in the sidepanel with live span count. Click to download a JSONL trace" |
| Show trace IDs | Display trace IDs in response stream | "Show trace IDs"; "Display trace IDs at the beginning of each response stream" |
| Show tool result details | Expand tool input/output blocks | "Show tool result details"; "Enable expandable tool result blocks" |
| Show system reminders | Debug tab context system reminders | "Display system reminder tags for debugging tab context changes" |
| Test notifications | Send test notifications from settings | "Test notifications"; "Test completion notification"; "Test permission notification" |
| Test conversations | Load canned conversation scenarios | "Test conversations"; "Load simple conversation"; "Load long conversation"; "Load tool use conversation" |
| Test scheduled task | Trigger a scheduled task immediately via Chrome Alarm (1s delay) | "Test Scheduled Task (via Alarm in 1s)" |
| Clear test data | Wipe test data from chrome.storage.local | "Clear test data"; "Test data cleared" |
| API configuration (internal) | Set API base URL, model override | "API configuration (internal)"; "API Base URL"; "Model Override"; "Production (api.anthropic.com)"; "Local (localhost:8080)" |
| Ant-only mode | Internal testing mode using Sessions API | "Ant-only: All future chats will use the new experience (Sessions API)." |
| Profiler | Performance profiler asset | `profiler-B46zK7FA.js` |

---

## (d) Settings Inventory

### Options Page Sections

**Keyboard shortcut**
- Configure the key combo to open the side panel (default: Ctrl+E / Cmd+E on Mac)
- Links to `chrome://extensions/shortcuts` to change

**Permissions**
- Your approved sites: list of sites where Claude has always-allow permission; Revoke per site
- Domain Transitions: rules for what happens when Claude crosses domains
- "Skip all permissions" warning + toggle

**Shortcuts**
- List of saved shortcuts (name + prompt)
- Create / Edit / Delete shortcuts
- "Type / in the chat to use shortcuts or run them on schedule"

**Scheduled** (tab)
- List of scheduled tasks tied to shortcuts
- Frequency: Once / Daily / Weekly / Monthly / Annually
- Time of day input

**Notifications**
- Task completion notification: on/off
- "You haven't set your notification preference yet" prompt

**Microphone**
- Enable microphone access for workflow recording voice narration
- State machine: blocked / denied / granted / unknown

**API Key Mode** (advanced)
- Enter Anthropic API key
- API Base URL (production/localhost)
- Switches auth from claude.ai to direct API

### In-Sidepanel Settings (accessible via ⋮ menu)

| Setting | Description |
|---|---|
| Model selector | Choose Claude model per conversation |
| Effort | Control extended thinking depth |
| System Prompt / Custom instructions | Override the default system prompt; placeholders: `modelName`, `currentDate`, `platform`, `platformModifier` |
| Language | Change extension UI language |
| Screenshot History | Number of screenshots kept in context (e.g., "1 (default, latest only)"; "All (keep every screenshot)") |
| Max Image Dimension | 768px / 1024px / 1280px / 1568px (default) |
| Image Format | JPEG / WebP / PNG |
| Image Quality | % slider (JPEG/WebP only) |
| Page Settle Timeout (ms) | Max time to wait for page to load after agent actions; 0 = disable |
| Permission mode toggle | Cycle between ask-before-acting / act-without-asking |
| Clear chat | Wipe current conversation |

### Debug Settings (hidden, Ant-only)

| Setting | Description |
|---|---|
| Show performance trace pill | JSONL trace download |
| Show trace IDs | Trace IDs in stream |
| Show tool result details | Expandable tool blocks |
| Show system reminders | Debug tab context tags |
| API Base URL override | Point at staging/localhost |
| Model Override | Force a specific model string |
| Load test conversation scenarios | Simple / long / tool-use |
| Test scheduled task | Trigger alarm in 1 second |
| Clear test data | Wipe storage |

---

## (e) Keyboard Shortcuts & Commands

| Shortcut | Action |
|---|---|
| Ctrl+E / Cmd+E | Toggle side panel open/closed |
| `/` in chat input | Open shortcuts/commands picker |
| `/[name]` | Run a named shortcut |

**Manifest commands:**
```json
"toggle-side-panel": {
  "suggested_key": { "default": "Ctrl+E", "mac": "Command+E" }
}
```

**Message commands (internal, service worker):**
- `EXECUTE_SCHEDULED_TASK` — run a saved scheduled shortcut
- `EXECUTE_TASK` — run an ad-hoc task
- `STOP_AGENT` — halt the current agent run
- `PLAY_NOTIFICATION_SOUND` / `OFFSCREEN_PLAY_SOUND` — trigger audio
- `GENERATE_GIF` — render animated GIF in offscreen document
- `OPEN_OPTIONS_WITH_TASK` — open options page to a specific tab
- `POPULATE_INPUT_TEXT` — fill the chat input with text
- `SWITCH_TO_MAIN_TAB` — bring the active agent tab to focus
- `STATIC_INDICATOR_HEARTBEAT` — keep agent visual indicator alive

---

## (f) Feature Classification for Open Rebuild

### Must-Have (core browser-control product)

| Feature | Notes |
|---|---|
| Side-panel chat UI | The entire product surface; non-negotiable |
| Browser agent actions | click, type, scroll, navigate, drag, hover, key press, form fill, find element | 
| Screenshot capture & display | Core perception loop |
| Accessibility tree injection | Enables semantic page understanding beyond pixels |
| Agent visual indicator | User trust signal that something is happening |
| Permission modes (ask / always / deny) | Without this, users cannot safely control the agent |
| Per-site permissions | Granular trust model |
| Plan mode (draft → approve → execute) | Critical safety pattern for autonomous agents |
| Page settle timeout | Practical robustness for dynamic pages |
| Read page / read console / read network | Core tool set for understanding page state |
| Execute JavaScript | Necessary for complex interactions |
| Web search + web fetch | Bread-and-butter agent capabilities |
| Extension conflict detection | Practical operational concern |
| Blocked page / org blocking | Enterprise deployment requirement |
| OpenRouter model selector | Our equivalent of the Claude model picker |
| System prompt customization | Per-user/per-workflow customization |
| Shortcuts (saved prompts with /) | High-value usability feature |
| Notifications + sound on task completion | Background task completion awareness |
| File upload to chat | Needed for document/image context |
| Clear chat | Basic chat management |

### Nice-to-Have (significant value, not blocking)

| Feature | Notes |
|---|---|
| Workflow recording ("Teach Claude") | High-value differentiator but complex (rrweb DOM recording + voice) |
| Scheduled tasks (cron shortcuts) | Requires background execution model; Chrome Alarms API |
| GIF export | Useful for sharing/demos; gif.js is self-contained |
| Mermaid / KaTeX / Cytoscape rendering | Great for developer/analyst users |
| Tab group awareness | Chrome-specific API; useful for multi-tab research |
| Conversation compaction | Needed for long-running tasks |
| Share conversation | Nice for sharing but requires backend |
| Voice narration for workflow recording | Requires mic API; nice UX |
| Domain transition pause | Safety feature for cross-domain navigation |
| Multi-browser pairing (switch_browser) | Needed only if targeting power users with multiple Chrome profiles |
| Multiple screenshot history modes | Token optimization; keep "latest only" as default |
| Image format/quality settings | Screenshot token optimization |
| Cowork/filesystem access | Requires native messaging host; significant scope expansion |
| Artifact rendering (interactive HTML apps) | Requires sandboxed iframe runtime |
| Conversation sharing | Requires backend storage |

### Claude-Product-Specific / Can Drop

| Feature | Notes |
|---|---|
| claude.ai SSO / login | Replace with OpenRouter API key or OAuth |
| API Key Mode (Anthropic API key) | Already our default model |
| Google Workspace MCP connectors | Keep only if high demand; requires OAuth infra |
| Slack connector | Keep only if high demand |
| Microsoft 365 connector | Same |
| Artifact sharing/remix | Requires claude.ai backend |
| Artifact reporting to Anthropic | Platform-specific moderation |
| Ant-only / Sessions API mode | Internal Anthropic experiment |
| "Antfood" internal testing | Internal Anthropic testing workflow |
| Profiler / trace download | Internal Anthropic telemetry |
| Safety filter fallback to different model | Anthropic-specific safety system |
| URL hash check API | Anthropic's proprietary blocklist |
| Org UUID enforcement (managed_schema) | Enterprise feature; can implement simpler alternative |
| Training data opt-out on reports | Anthropic privacy controls |
| Cowork upsell banners | Marketing for Anthropic product |
| Bridge WebSocket (wss://bridge.claudeusercontent.com) | claude.ai-specific realtime transport |
| Onboarding prompts on claude.ai | Content-script runs on claude.ai only |
| Desktop screenshot capability | Requires native host; edge case |
| Memory editor (Cowork) | Anthropic-specific memory system |

---

## (g) Open Questions

1. **Workflow recording replay mechanism**: The rrweb-style recording in `startRecording-DT2Ni7PN.js` captures DOM mutations, but it's unclear how the replay works — is it sent to Claude as context to generate an automation script, or is there a direct replay path? The i18n strings suggest Claude generates a repeatable workflow from the demonstration, not that rrweb sessions are replayed directly.

2. **Cowork / native messaging scope**: The `nativeMessaging` permission and hosts `com.anthropic.claude_browser_extension` / `com.anthropic.claude_code_browser_extension` suggest file system access goes through a separate native host process. The full capabilities of Cowork mode (e.g., can it run shell commands?) are not fully confirmed from the assets examined; "Ran terminal" exists as a UI string (`3HqwPnSzes`) suggesting yes.

3. **Sessions API vs. standard API**: The "Ant-only" Sessions API mode is toggled in debug settings. This appears to be an experimental new Anthropic API for stateful browser sessions. Our rebuild would use the standard Messages API (via OpenRouter).

4. **Bridge WebSocket**: The extension connects to `wss://bridge.claudeusercontent.com` — this may be used for real-time streaming of claude.ai responses into the extension, or for the pairing handshake. Our rebuild uses direct API calls so this is not needed.

5. **Tab group screenshots vs. standard screenshots**: `1if5aMN6aR: "Desktop screenshots"` and `J1RykLtxKE: "Desktop screenshot"` suggest there's a capability to capture the full desktop, not just a browser tab. This likely requires a native host. Worth investigating whether this is actually functional or only in Cowork mode.

6. **Plan mode trigger**: It is unclear from the assets whether plan mode is always-on, user-toggled, or model-triggered. The i18n shows both "Drafting plan..." (Claude creates it) and "Approve plan" / "Plan rejected" (user interaction), suggesting it is an optional mode Claude enters before complex multi-step tasks.

7. **Google Workspace MCP**: Endpoints point to both Anthropic-hosted servers (`gcal.mcp.claude.com`, `gmail.mcp.claude.com`) and Google-hosted servers (`calendarmcp.googleapis.com`, `gmailmcp.googleapis.com`). It is unclear which endpoints are live vs. in transition.

8. **"Computer action: {action}"** string: Suggests a possible CUA (Computer Use API) integration where actions are described generically. The presence of `xLpBTyWHMH: "Computer action: {action}"` alongside the specific click/type/scroll tools may indicate dual code paths.
