# 03 — Page Perception Subsystem

Analysis of Claude in Chrome v1.0.75's page-perception pipeline: how it reads web pages for the model, resolves coordinates, and maps model actions back to the DOM.

---

## (a) Summary

The extension uses **two independent perception channels** that can be called separately by the model:

1. **Accessibility / DOM tree** (`read_page` / `find` tools) — a custom DOM walk that produces a compact text tree with stable element references (`ref_N`). This is the primary text-based page representation.
2. **Screenshot** (`screenshot` / `computer` tool's `screenshot` action) — a JPEG image captured via the Chrome DevTools Protocol (`Page.captureScreenshot`), downscaled to fit within Claude's vision-token budget, then returned as base64. The model sees CSS-pixel coordinates in the screenshot space.

The two channels are used together in practice: the model may call `read_page` to find elements by `ref_id` and use those refs for clicks, or it may use a screenshot to pick coordinates visually.

---

## (b) Accessibility / DOM Tree Extraction

### Injection

File: `assets/accessibility-tree.js-CCweLwU2.js`  
Manifest: injected as a content script at `"run_at": "document_start"`, `"all_frames": true`, into `<all_urls>`.

It exposes a single global function: `window.__generateAccessibilityTree(filter, depth, maxChars, refId)`.

### What it walks

The script performs a **custom DOM walk** (`x()` function) on `document.body`. It does **not** use the Chrome native a11y tree (`chrome.automation` API). Instead it iterates `element.children` recursively and decides whether each element is worth emitting.

**Inclusion rules** (function `y()`):
- Skips `<script>`, `<style>`, `<meta>`, `<link>`, `<title>`, `<noscript>`.
- Skips `aria-hidden="true"` elements (unless `filter === "all"`).
- Skips invisible elements (CSS `display:none`, `visibility:hidden`, `opacity:0`, zero offsetWidth/Height) unless `filter === "all"`.
- Skips elements outside the current viewport rect unless a `refId` focus is requested.
- **Always includes** if: element is interactive (`b()`), or is a landmark/heading (`_()`), or has a non-empty accessible name (`w()` returns >0 chars).
- In `"interactive"` filter mode, only interactive elements pass.

**Interactive elements** (`b()`): `a`, `button`, `input`, `select`, `textarea`, `details`, `summary`, elements with `onclick`/`tabindex` attributes, `role="button"`, `role="link"`, or `contenteditable="true"`.

**Landmark / structural elements** (`_()`): `h1`–`h6`, `nav`, `main`, `header`, `footer`, `section`, `article`, `aside`, and any element with an explicit `role` attribute.

### Role inference (`g()`)

Falls back from explicit `role` attribute to a tag→role mapping:

```js
{ a:"link", button:"button", input:"textbox"(default)/"button"/"checkbox"/"radio"/"button",
  select:"combobox", textarea:"textbox", h1-h6:"heading", img:"image",
  nav:"navigation", main:"main", header:"banner", footer:"contentinfo",
  section:"region", article:"article", aside:"complementary",
  form:"form", table:"table", ul/ol:"list", li:"listitem", label:"label" }
```

Unknown tags return `"generic"`.

### Accessible name computation (`w()`)

Priority order:
1. `aria-label` attribute
2. `placeholder` attribute
3. `title` attribute
4. `alt` attribute (images)
5. `<label for="...">` linked label text
6. `value` attribute (submit inputs)
7. Direct `textContent` of child text nodes (for `button`, `a`, `summary`)
8. Full `textContent` for headings (capped at 100 chars)
9. Child text-node concatenation for other elements (only if ≥3 chars, capped at 100 chars with `"..."`)

**Password / sensitive fields**: inputs with `type="password"`, `type="hidden"`, or autocomplete values like `current-password`, `cc-number`, etc. return `"[value redacted]"`.

**Select elements**: returns the selected `<option>` text (or `aria-label`/`title` for sensitive selects).

### Element reference system

Every included element gets a stable string identifier: `ref_<N>` (e.g. `ref_42`).

Storage:
```js
window.__claudeElementMap     // { "ref_N": WeakRef<Element> }
window.__claudeElementReverseMap  // WeakMap<Element, "ref_N">
window.__claudeRefCounter     // global incrementing counter
```

Assignment: on first visit, `window.__claudeRefCounter` is incremented and a new `WeakRef` is stored. On subsequent walks of the same page, the reverse map reuses the existing `ref_N` for the same element — refs are stable across tree reads (as long as the element stays in the DOM). Dead WeakRefs are cleaned up at the end of each tree walk.

**No XPaths, no CSS selectors, no coordinates** are used for identification. The ref is the sole handle.

### Serialized format

Each included node becomes one line in a text array, indented by `depth * " "`:

```
<indent><role> "<name>" [ref_N] href="..." type="..." placeholder="..."
```

Examples:
```
link "Home" [ref_1] href="/"
  heading "Welcome to our site" [ref_2]
button "Search" [ref_3] type="submit"
combobox "Country" [ref_4]
 option "United States" (selected) value="US"
 option "Canada" value="CA"
textbox "Email address" [ref_5] placeholder="you@example.com"
```

The full tree is joined with `"\n"`. Limits:
- Max 10,000 nodes (hard cap; `o=1e4`).
- Max depth defaults to 15 (`a=15`).
- Max characters defaults to 50,000.
- Truncation messages are appended when limits are hit.

Return value shape:
```js
{
  pageContent: string,           // the text tree
  viewport: { width: number, height: number }  // window.innerWidth/Height
}
```

### Frame handling

The accessibility-tree content script is injected into **all frames** (`"all_frames": true`). However, `__generateAccessibilityTree` walks only the `document.body` of the frame it runs in. Each frame is an independent walk. The `read_page` tool invokes the script via `chrome.scripting.executeScript` targeting a single tab (not `allFrames`), so it reads only the **top frame**. Cross-frame trees are not merged automatically.

---

## (c) Screenshot Pipeline

### Method

Screenshots are captured via the **Chrome Debugger Protocol (CDP)** — specifically `Page.captureScreenshot`. The extension attaches `chrome.debugger` to the target tab (protocol version `"1.3"`) and calls `debugger.sendCommand()`. `chrome.tabs.captureVisibleTab` is not used.

### Step-by-step

**Step 1 — Probe viewport** (`executeScript` into the tab):
```js
{
  width: window.innerWidth,
  height: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio,
  scrollX: window.scrollX,
  scrollY: window.scrollY,
  visibility_state: document.visibilityState
}
```

**Step 2 — Compute target resolution** (`R(physicalW, physicalH, params)`):

The physical pixel dimensions are `innerWidth × DPR` by `innerHeight × DPR`. These are downscaled to fit within:
```js
const C = { pxPerToken: 28, maxTargetPx: 1568, maxTargetTokens: 1568 };
```
- Token count = `ceil(w/28) × ceil(h/28)`
- If token count ≤ 1568 and both dimensions ≤ 1568px → keep original size.
- Otherwise, binary-search for the largest width that satisfies both constraints while preserving aspect ratio.

**Step 3 — Determine clip vs full-page** (`captureScreenshotClipScale` flag + visibility state):

If the document is visible (`visibilityState === "visible"`) and the feature flag is not set, a `clip` parameter is added:
```js
clip: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scale: I }
```
where `scale I = min(1, targetWidth / physicalWidth)` — a combined CSS→physical→downscale ratio.

If not clipping, `captureBeyondViewport: false, fromSurface: true` is used without a clip.

**Step 4 — CDP call**:
```js
Page.captureScreenshot({
  format: "jpeg",          // default; can be "png" for zoom
  quality: 75,             // INITIAL_JPEG_QUALITY = 0.75 → quality param is quality*100
  captureBeyondViewport: false,
  fromSurface: true,
  clip: { x, y, width, height, scale }  // optional
})
```
Returns `{ data: base64string }`.

**Step 5 — Size check and early exit**:

If clip was used and `base64.length <= MAX_BASE64_CHARS (1,398,100)`, the base64 is returned as-is. This skips canvas reprocessing.

**Step 6 — Content-script canvas reprocessing** (when not clipping, or result exceeds size limit):

`processScreenshotInContentScript()` injects a script into the page that:
1. Loads the CDP-returned base64 as `<img>`.
2. Draws it into a `<canvas>` scaled by `1/DPR` (to get CSS pixels) if DPR > 1.
3. Applies the token-budget downscaling computed in Step 2 if the image is still too large.
4. **Iterative JPEG quality reduction**: starts at `quality=0.75`, steps down by `0.05` until `base64.length ≤ MAX_BASE64_CHARS` or quality hits `MIN_JPEG_QUALITY = 0.10`.
5. Returns `{ base64, width, height, format, viewportWidth, viewportHeight }`.

**Step 7 — Screenshot context saved**:

The `$` context store saves per-tab:
```js
{ viewportWidth, viewportHeight, screenshotWidth, screenshotHeight }
```
This is used to remap model coordinates back to viewport coordinates.

### Offscreen document role

`offscreen.js` is used **only for GIF generation** (share feature). It receives an array of screenshot frames + action metadata via `chrome.runtime.sendMessage({ type: "GENERATE_GIF", frames, options })`, composites click indicators / drag paths / watermarks onto canvases using the `gif.js` library, and returns a base64-encoded GIF. It does **not** participate in the live screenshot pipeline.

### Zoom action

Uses `Page.captureScreenshot` with a PNG format clip precisely covering the specified `[x0, y0, x1, y1]` region (converted to physical pixels via DPR). If not clipping, draws a sub-region of the full screenshot on a canvas.

---

## (d) Coordinate System and Mapping

### Screenshot space vs viewport space

The model receives a screenshot image of dimensions `screenshotWidth × screenshotHeight` pixels. The model's coordinate outputs are **in screenshot pixel space**.

The actual CDP `Input.dispatchMouseEvent` (and scroll) calls use **CSS viewport pixel coordinates** (logical pixels, matching what `getBoundingClientRect()` and `window.innerWidth/Height` report, without scroll offset).

### Inverse mapping: `De(x, y, context)`

```js
function De(e, t, r) {
  const o = r.viewportWidth / r.screenshotWidth;   // CSS px per screenshot px
  const a = r.viewportHeight / r.screenshotHeight;
  return [Math.round(e * o), Math.round(t * a)];
}
```

Applied to every coordinate action (click, scroll, hover, drag) when a screenshot context exists for the tab.

### Click flow with refs

When a `ref_N` identifier is used instead of coordinates, `qe()` resolves it:
```js
// In the page context:
const el = window.__claudeElementMap["ref_N"].deref();
el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
const rect = el.getBoundingClientRect();
return { success: true, coordinates: [rect.left + rect.width/2, rect.top + rect.height/2] };
```

These are already CSS viewport coordinates (relative to the current scroll position), so **no `De()` remapping is applied** — they go directly to `Input.dispatchMouseEvent`.

### Scroll offsets

The model's coordinates are viewport-relative, not page-relative. Scroll offset is handled implicitly:
- The screenshot clip uses `scrollX`/`scrollY` as the clip origin, so the screenshot always shows the current viewport.
- `getBoundingClientRect()` returns coordinates relative to the viewport, not the page origin.
- `Input.dispatchMouseEvent` takes viewport-relative coordinates in CDP.

No explicit scroll-offset arithmetic is needed for clicks. The `scroll_to` action uses `scrollIntoView()` to bring the target element into the viewport before clicking.

### Physical pixel notes

`Input.dispatchMouseEvent` in CDP accepts **CSS pixel coordinates** (not physical pixels), so there is no need to multiply by DPR for mouse events. The DPR only matters for the screenshot resolution calculation.

---

## (e) Visual Indicator Overlay

File: `assets/agent-visual-indicator.js-DVYDybPo.js`  
Manifest: injected at `document_idle`, `all_frames: false` (top frame only), `<all_urls>`.

Controlled entirely by `chrome.runtime.onMessage` from the background worker. No MCP tool directly calls it; the screenshot/click functions call `j.hideIndicatorForToolUse(tabId)` / `j.restoreIndicatorAfterToolUse(tabId)` which send messages to the visual indicator.

### Components

**1. Phantom cursor** (`#claude-phantom-cursor`):
- A `position: fixed` div with a CSS `translate3d` transform, containing two SVG cursor shapes: a plain white cursor (`#claude-phantom-cursor-plain`) and a styled cursor (`#claude-phantom-cursor-styled`) in Claude's orange `#D97757` with a `drop-shadow` glow.
- Movement is animated: `transition: transform 180ms cubic-bezier(0.2, 0, 0, 1)`.
- Positioned by message `UPDATE_PHANTOM_CURSOR { x, y }` (CSS viewport px). The extension sends this before every mouse event to animate the cursor moving.

**2. Agent glow border** (`#claude-agent-glow-border`):
- A `position: fixed; inset: 0` overlay with an inset `box-shadow` in Claude orange, pulsing via `@keyframes claude-pulse` (2s ease-in-out, `opacity: 0.6 → 1.0`).
- Shown via `SHOW_AGENT_INDICATORS`, hidden via `HIDE_AGENT_INDICATORS`.

**3. Stop button** (`#claude-agent-stop-button`):
- A pill button at `bottom: 16px; left: 50%`. Slides in from below (`translateY(100px → 0)`) when agent starts.
- On click, sends `{ type: "STOP_AGENT", fromTabId: "CURRENT_TAB" }` to background.
- MCP mode is detected (`isMcp: true` in the `SHOW_AGENT_INDICATORS` message) via the `L` flag; a subtle AudioContext is kept alive for notification sounds.

**4. Static indicator** (`#claude-static-indicator-container`):
- A persistent pill shown at bottom-center when Claude is active in the tab group but not currently running an action.
- Contains Claude's logo SVG, the text "Claude is active in this tab group", an "Open chat" icon button, and a "Dismiss" button.
- Maintained by a 5-second heartbeat: `STATIC_INDICATOR_HEARTBEAT` → background confirms it's still active.

### Visibility management during tool use

Before every screenshot or action:
1. `HIDE_FOR_TOOL_USE` hides all overlays (cursor, glow, stop button, static pill).
2. After capture: `SHOW_AFTER_TOOL_USE` restores them.
3. This ensures overlays don't appear in screenshots.

---

## (f) Reusable vs Claude-Specific

### Fully reusable verbatim

| Component | Notes |
|---|---|
| `accessibility-tree.js` DOM walker | Pure DOM code, no Anthropic references. Can be copied as-is into any MCP extension. The `window.__generateAccessibilityTree` interface is clean. |
| `De()` coordinate inverse-mapping | 4-line function; essential for screenshot-coordinate-to-click mapping. |
| Screenshot resize algorithm `R()` | The token-budget math (`pxPerToken:28, maxTargetPx:1568, maxTargetTokens:1568`) matches Claude's vision model tile grid. May need adjustment for other providers. |
| CDP `Page.captureScreenshot` with clip | Standard CDP; works with any Chromium-based browser controlled via the debugger protocol. |
| JPEG quality step-down loop | Generic canvas recompression; reusable. |
| Screenshot context store (`$` class) | Simple `Map<tabId, {viewport+screenshot dims}>` pattern. |
| `qe()` ref-to-coordinate resolver | Resolves `ref_N` to `getBoundingClientRect` center; pure DOM code. |
| GIF generation pipeline (offscreen.js) | Fully generic; no Claude API calls. The `applyActionIndicators`/`drawClickIndicator`/`drawDragPath` drawing functions are reusable for any action recording feature. |

### Claude-specific (needs adaptation)

| Component | Notes |
|---|---|
| `find` tool's LLM sub-call | Calls `createAnthropicMessage` with `modelClass: "small_fast"`. Replace with equivalent OpenRouter call (e.g. `claude-3-haiku` or `gemini-flash`). |
| `maxTargetPx: 1568`, `pxPerToken: 28` | Tuned for Claude's vision tile system (1568 = 56×28 tiles). For other models, check their documentation for max image size. |
| `INITIAL_JPEG_QUALITY: 0.75`, `MAX_BASE64_CHARS: 1,398,100` | The char limit approximates Claude's max image bytes. Adjust for target model. |
| `computer` tool description template | Contains `{self.display_width_px}x{self.display_height_px}` placeholder (not yet substituted in the bundle — this is a bug/artifact). |
| Agent visual indicator colors | `#D97757` (Claude orange) and `#FAF9F5` (off-white) are brand-specific. |
| `STOP_AGENT` / heartbeat messaging | Coupled to the extension's background service worker architecture. |

---

## (g) Open Questions

1. **Viewport coordinate vs physical pixel for `Input.dispatchMouseEvent`**: The code passes CSS pixels from `getBoundingClientRect()` or `De()`-remapped coords directly. On high-DPR displays, some CDP implementations expect physical pixels. Need to verify behavior on Retina/HiDPI displays.

2. **Cross-frame accessibility**: `read_page` reads only the top frame. If an important UI element lives inside an `<iframe>` (e.g., embedded payment forms, rich text editors), it will be invisible to the a11y tree. The content script is injected into all frames, so a future tool could target a specific frameId.

3. **`captureScreenshotClipScale` kill switch**: This `chrome.storage.local` flag can disable clip-based screenshots. It's unclear what triggers this flag — possibly a fallback for pages that misbehave with the clip path.

4. **`computer` tool description placeholder**: The description string contains `{self.display_width_px}x{self.display_height_px}` — a Python-style format string that is never substituted in the JS bundle. The model therefore receives a literal `{self.display_width_px}` in the prompt. This appears to be a porting artifact from the Anthropic computer-use reference implementation.

5. **MCP vs extension modes**: The `L` flag (`isMcp: true` in `SHOW_AGENT_INDICATORS`) suggests different behavior in MCP mode. The exact differences beyond AudioContext initialization are unclear.

6. **Scroll direction in `pageContent`**: The a11y tree filters out elements outside the viewport rect (when not using `refId`). This means a page with 10,000 DOM nodes only shows the currently visible ones — which is efficient but means the model can't discover off-screen content without scrolling first.

7. **`stripExtensionInterference`**: There is an elaborate function that removes cross-origin `<iframe>` elements before screenshots to prevent interference from other extensions. This may be needed in production MCP setups too.
