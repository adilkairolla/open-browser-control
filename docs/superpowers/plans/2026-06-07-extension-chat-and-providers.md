# Extension Chat + Provider Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chrome side-panel chat UI to the `@obc/extension` package: clicking the toolbar icon groups the current tab and opens a chat panel where the user connects an LLM provider (API key for all, OAuth/subscription for Anthropic), picks a provider+model, and chats — all driven by the pi agent runtime in-browser. No browser-control tools in this phase.

**Architecture:** The whole product runs in the side-panel page (a React app) so streaming survives MV3 service-worker termination. The service worker only handles the icon click (group current tab + open panel). Chat goes through pi's `Agent` class (`@earendil-works/pi-agent-core`) which calls providers via `fetch` directly from the panel (extension pages bypass CORS via host permissions). Credentials live in `chrome.storage.local`; a single `getApiKey(provider)` resolver feeds keys/OAuth tokens to pi (Anthropic OAuth tokens are auto-detected by pi via the `sk-ant-oat` substring). The MCP/native-host packages are untouched.

**Tech Stack:** Bun workspaces · TypeScript 6 (strict, `verbatimModuleSyntax`) · Vite 8 + vite-plugin-web-extension 4.5 · React 19 + `@vitejs/plugin-react` · Tailwind v4 (`@tailwindcss/vite`) · coss.com/ui components (shadcn registry, `@base-ui/react`) · `@earendil-works/pi-ai@0.78.1` + `@earendil-works/pi-agent-core@0.78.1` · `bun test`.

---

## Reference facts (verified against `.var/pi` source @ commit ff3e9df and live coss registry)

These are quoted in the tasks; collected here so the tasks stay short.

**pi packages** — `@earendil-works/pi-ai@0.78.1` (main export browser-safe; avoid subpaths `/oauth`, `/bedrock-provider`) and `@earendil-works/pi-agent-core@0.78.1` (main export browser-safe; avoid `/node`). pi-ai's deps include node-only `@aws-sdk/client-bedrock-runtime`, `@smithy/node-http-handler`, `http-proxy-agent`, `https-proxy-agent` — reached only via variable/dynamic imports, so we stub them in Vite (Task 1).

**pi-ai chat API:**
- `getProviders(): KnownProvider[]`, `getModels(provider): Model[]`, `getModel(provider, id): Model` (generic-typed; we use `getModels(p).find(m => m.id === id)` for runtime string lookups).
- `Model` fields we use: `id`, `name`, `provider`, `contextWindow`, `reasoning`, `input`.
- Credentials passed via `StreamOptions.apiKey` (exact field name). Anthropic OAuth: if `apiKey` contains the substring `sk-ant-oat`, pi switches the SDK to `authToken` (Bearer) and injects the `claude-code-20250219,oauth-2025-04-20` beta headers + a mandatory `"You are Claude Code, Anthropic's official CLI for Claude."` system prefix automatically. So our resolver just returns the OAuth **access token** as the apiKey.

**Provider slugs + sample model ids** (from `models.generated.ts`): `openrouter` (`anthropic/claude-3.5-haiku`, api `openai-completions`, base `https://openrouter.ai/api/v1`), `openai` (`gpt-4o`, api `openai-responses`), `anthropic` (`claude-3-5-haiku-20241022`, api `anthropic-messages`), `google` (`gemini-2.5-flash`), `groq` (`llama-3.1-8b-instant`), `xai` (`grok-3`), `deepseek` (`deepseek-v4-flash`).

**pi-agent-core `Agent`:**
- `new Agent(options?: AgentOptions)`. For no-tools chat, the only effective required field is `initialState.model`. All else optional; default `convertToLlm` is correct for chat.
- `getApiKey?: (provider: string) => Promise<string|undefined>|string|undefined` — resolved before each call as `(getApiKey(model.provider)) || config.apiKey`, then passed to the stream as `apiKey`. This is the credential path (no custom-header plumbing needed for our 7 providers).
- `streamFn?: StreamFn` — optional override of the LLM call. We use this only in tests to inject a fake stream.
- `agent.subscribe((event, signal) => ...)` returns an unsubscribe fn. Streaming text arrives on `event.type === "message_update"` where `event.assistantMessageEvent.type === "text_delta"` carries `.delta: string`. `event.assistantMessageEvent.type === "error"` carries `.error` (an AssistantMessage with `errorMessage`).
- `agent.prompt(text)` sends a user message and resolves after the turn ends (does NOT throw on abort; check `agent.state.messages` last item `stopReason`/`errorMessage`). Do not call `prompt()` while streaming.
- `agent.state.model` is a writable property — reassign to switch model. `agent.state.messages: AgentMessage[]`, `agent.state.isStreaming`, `agent.state.streamingMessage?`, `agent.state.errorMessage?`.
- `agent.abort()`.

**Anthropic OAuth (browser-safe, no callback server)** — exact constants/flow from `.var/pi/packages/ai/src/utils/oauth/{pkce,anthropic}.ts`:
- `CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"`, `AUTHORIZE_URL = "https://claude.ai/oauth/authorize"`, `TOKEN_URL = "https://platform.claude.com/v1/oauth/token"`, `REDIRECT_URI = "http://localhost:53692/callback"`, `SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"`.
- PKCE uses Web Crypto only (browser-safe). State === PKCE verifier (intentional dual-use).
- Authorize URL includes a non-standard `code=true` param (replicate it).
- Token exchange POST body: `{grant_type:"authorization_code", client_id, code, state, redirect_uri, code_verifier}`. Refresh POST body: `{grant_type:"refresh_token", client_id, refresh_token}` (NO `scope`). `expires = Date.now() + expires_in*1000 - 300_000`.
- We have no server, so the user pastes the redirect URL/code; `parseRedirect` handles full-URL / `code#state` / `code=..&state=..` / bare-code forms.

**coss.com/ui** — shadcn registry at `https://coss.com/ui/r/<name>.json`, built on `@base-ui/react` + Tailwind v4 + `class-variance-authority` + `lucide-react`. Add via `bunx shadcn@latest add @coss/<name> --yes` (or the direct URL form). `rsc:false` for Vite; no `tailwind.config.ts` (Tailwind v4).

**Current files** (verbatim) — see Task references; key points: root is a Bun workspace (`bun.lock`), `tsconfig.base.json` has `verbatimModuleSyntax:true` (use `import type`), extension uses `vite@^8` + `vite-plugin-web-extension@^4.5.1`, manifest has `action.default_popup` (must be removed so `action.onClicked` fires).

---

## File structure (created/modified in this plan)

```
packages/extension/
  package.json            (modify: add React/Tailwind/pi deps)
  manifest.json           (modify: side_panel, sidePanel+tabGroups perms, drop default_popup)
  vite.config.ts          (modify: react + tailwind plugins, @ alias, node-stub aliases, define)
  tsconfig.json           (modify: jsx, paths)
  components.json          (create: shadcn/coss config)
  src/
    background.ts         (modify: icon -> group tab + open side panel)
    vite-env.d.ts         (create: vite client types)
    sidepanel/
      index.html          (create)
      main.tsx            (create: React root)
      index.css           (create: tailwind v4 + coss tokens)
      App.tsx             (create: empty-state vs chat routing)
      lib/
        empty-stub.ts     (create: node-dep stub for Vite)
        utils.ts          (create: cn())
        kv.ts             (create: KeyValueStore + chrome backend + memory backend)
        authStore.ts      (create: credential CRUD + getToken w/ refresh)
        settingsStore.ts  (create: defaultProvider/defaultModel)
        providers.ts      (create: curated catalog + model listing)
        oauthAnthropic.ts (create: pkce/authorize/exchange/refresh/parse)
        chat.ts           (create: ChatSession wrapping pi Agent)
      components/
        ui/               (create via coss CLI: button, dialog, select, textarea, scroll-area, spinner)
        EmptyState.tsx    (create)
        ConnectProviderDialog.tsx (create)
        ProviderModelSelector.tsx (create)
        Chat.tsx          (create)
  test/
    kv.test.ts
    authStore.test.ts
    settingsStore.test.ts
    providers.test.ts
    oauthAnthropic.test.ts
    chat.test.ts
```

`src/popup/` is removed (replaced by the side panel).

---

## Task 0: Branch + dependencies

**Files:**
- Modify: `packages/extension/package.json`

- [ ] **Step 1: Create a feature branch**

Run from repo root:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git checkout -b feat/sidepanel-chat
```
Expected: `Switched to a new branch 'feat/sidepanel-chat'`.

- [ ] **Step 2: Add runtime + dev dependencies to the extension package**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun add @earendil-works/pi-ai@0.78.1 @earendil-works/pi-agent-core@0.78.1 \
  react@^19 react-dom@^19 \
  @base-ui/react class-variance-authority lucide-react clsx tailwind-merge \
  @fontsource-variable/inter geist
bun add -d @vitejs/plugin-react @types/react @types/react-dom \
  tailwindcss @tailwindcss/vite tw-animate-css
```
Expected: installs succeed; `packages/extension/package.json` now lists these. (If `@vitejs/plugin-react` warns about a `vite@8` peer mismatch, continue — it is verified to work in Task 1; only if Task 1's build fails revisit by pinning `vite` to `^7` in this package.)

- [ ] **Step 3: Verify lockfile updated and commit**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/package.json bun.lock
git commit -m "chore(extension): add React, Tailwind, coss, and pi deps"
```
Expected: commit created.

---

## Task 1: React + Tailwind + side-panel scaffold (config + hello-world)

**Files:**
- Create: `packages/extension/src/sidepanel/index.html`
- Create: `packages/extension/src/sidepanel/main.tsx`
- Create: `packages/extension/src/sidepanel/index.css`
- Create: `packages/extension/src/sidepanel/App.tsx`
- Create: `packages/extension/src/sidepanel/lib/empty-stub.ts`
- Create: `packages/extension/src/vite-env.d.ts`
- Modify: `packages/extension/vite.config.ts`
- Modify: `packages/extension/tsconfig.json`
- Modify: `packages/extension/manifest.json`
- Delete: `packages/extension/src/popup/` (index.html, popup.css, popup.ts)

- [ ] **Step 1: Create the Vite node-dependency stub**

Create `packages/extension/src/sidepanel/lib/empty-stub.ts`:
```ts
// Stub for node-only modules that pi-ai references behind dynamic/variable imports
// (bedrock, http proxy agents). They are never executed in our 7-provider build.
export default {};
```

- [ ] **Step 2: Replace `vite.config.ts`**

Overwrite `packages/extension/vite.config.ts`:
```ts
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import webExtension from "vite-plugin-web-extension";

const stub = path.resolve(__dirname, "src/sidepanel/lib/empty-stub.ts");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    webExtension({ manifest: "manifest.json" }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/sidepanel"),
      // Stub node-only deps pulled transitively by pi-ai (bedrock/proxy paths).
      "@aws-sdk/client-bedrock-runtime": stub,
      "@smithy/node-http-handler": stub,
      "http-proxy-agent": stub,
      "https-proxy-agent": stub,
    },
  },
  define: {
    // pi modules occasionally read process.env.* directly; provide a safe shim.
    "process.env": "{}",
    global: "globalThis",
  },
});
```

- [ ] **Step 3: Add Vite client types**

Create `packages/extension/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Update `tsconfig.json` for JSX + path alias**

Overwrite `packages/extension/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["chrome"],
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/sidepanel/*"]
    }
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **Step 5: Create the side-panel HTML entry**

Create `packages/extension/src/sidepanel/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open Browser Control</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create the CSS entry (Tailwind v4 + coss neutral tokens)**

Create `packages/extension/src/sidepanel/index.css`:
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@fontsource-variable/inter";
@import "geist/dist/mono.css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: #ffffff;
  --foreground: #262626;
  --card: #ffffff;
  --card-foreground: #262626;
  --popover: #ffffff;
  --popover-foreground: #262626;
  --primary: #262626;
  --primary-foreground: #fafafa;
  --secondary: #f5f5f5;
  --secondary-foreground: #262626;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --accent: #f5f5f5;
  --accent-foreground: #262626;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: #e5e5e5;
  --input: #e5e5e5;
  --ring: #a3a3a3;
}

.dark {
  --background: #171717;
  --foreground: #fafafa;
  --card: #262626;
  --card-foreground: #fafafa;
  --popover: #262626;
  --popover-foreground: #fafafa;
  --primary: #fafafa;
  --primary-foreground: #262626;
  --secondary: #2e2e2e;
  --secondary-foreground: #fafafa;
  --muted: #2e2e2e;
  --muted-foreground: #a3a3a3;
  --accent: #2e2e2e;
  --accent-foreground: #fafafa;
  --destructive: #f87171;
  --destructive-foreground: #171717;
  --border: #2e2e2e;
  --input: #2e2e2e;
  --ring: #525252;
}

@theme inline {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@media (prefers-color-scheme: dark) {
  :root:not(.light) {
    color-scheme: dark;
  }
}

* {
  border-color: var(--color-border);
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
}
```

- [ ] **Step 7: Create a placeholder `App.tsx`**

Create `packages/extension/src/sidepanel/App.tsx`:
```tsx
export function App() {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <p className="text-sm text-muted-foreground">Open Browser Control — side panel ready.</p>
    </div>
  );
}
```

- [ ] **Step 8: Create the React root `main.tsx`**

Create `packages/extension/src/sidepanel/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
```

- [ ] **Step 9: Update the manifest (side panel + permissions, remove popup)**

Overwrite `packages/extension/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "Open Browser Control",
  "version": "0.0.1",
  "description": "Drive this browser from an AI client, with an in-panel chat.",
  "permissions": ["nativeMessaging", "tabs", "scripting", "activeTab", "sidePanel", "tabGroups"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background.ts",
    "type": "module"
  },
  "action": {
    "default_title": "Open Browser Control"
  },
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  }
}
```

- [ ] **Step 10: Delete the old popup**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
rm -rf src/popup
```

- [ ] **Step 11: Build and verify the bundle loads**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run build
```
Expected: build completes; `dist/` contains `manifest.json` with `side_panel.default_path` rewritten to the built HTML, and a built sidepanel HTML/JS/CSS. **If the build errors on a node module** (e.g. `node:fs`, an aws-sdk file, a proxy agent): add that exact specifier to the `resolve.alias` stub list in `vite.config.ts` and rebuild. (The four common ones are already stubbed.)

- [ ] **Step 12: Typecheck**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run typecheck
```
Expected: no errors. (If `cn`/component imports are referenced they don't exist yet — at this point only App/main exist, so it should pass.)

- [ ] **Step 13: Manual smoke — panel renders**

Load `packages/extension/dist` via `chrome://extensions` → *Load unpacked*. Click the toolbar icon — at this stage it does nothing yet (no onClicked handler). Instead, open the side panel manually (right-click icon → "Open side panel", or it may not appear until Task 2). To verify the page renders, open `chrome-extension://<id>/src/sidepanel/index.html` in a tab — you should see "side panel ready." styled with the system font.

- [ ] **Step 14: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension
git commit -m "feat(extension): React + Tailwind side-panel scaffold"
```

---

## Task 2: Service worker — icon click groups tab + opens panel

**Files:**
- Modify: `packages/extension/src/background.ts`

- [ ] **Step 1: Replace `background.ts`**

Overwrite `packages/extension/src/background.ts`:
```ts
// The toolbar icon: group the current tab (like the Claude extension) and open
// the chat side panel. We control opening ourselves (so we can also group), so
// disable the built-in open-on-click behavior.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.warn("[OBC] setPanelBehavior failed", err));

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || tab.windowId === undefined) return;

  // Group the active tab. Some tabs (chrome://, the New Tab page) can't be
  // grouped — ignore failures so the panel still opens.
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, {
      title: "Open Browser Control",
      color: "blue",
    });
  } catch (err) {
    console.warn("[OBC] could not group tab", err);
  }

  // Must be called from a user-gesture handler (the icon click qualifies).
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
```

- [ ] **Step 2: Build**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run build
```
Expected: success.

- [ ] **Step 3: Manual verify**

Reload the unpacked extension in `chrome://extensions`. Open any normal web page (e.g. `https://example.com`). Click the toolbar icon. Expected: the current tab becomes part of a blue "Open Browser Control" tab group, and the side panel opens on the right showing "side panel ready."

- [ ] **Step 4: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/background.ts
git commit -m "feat(extension): icon click groups tab and opens side panel"
```

---

## Task 3: coss UI foundation (utils + components)

**Files:**
- Create: `packages/extension/components.json`
- Create: `packages/extension/src/sidepanel/lib/utils.ts`
- Create: `packages/extension/src/sidepanel/components/ui/*` (via CLI or curl fallback)

- [ ] **Step 1: Write `components.json`**

Create `packages/extension/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/sidepanel/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": {
    "coss": { "url": "https://coss.com/ui/r", "style": "default" }
  }
}
```

- [ ] **Step 2: Write `lib/utils.ts` (the `cn` helper)**

Create `packages/extension/src/sidepanel/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Add coss components via the shadcn CLI**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bunx --bun shadcn@latest add @coss/button @coss/dialog @coss/select @coss/textarea @coss/scroll-area @coss/spinner --yes --overwrite
```
Expected: TSX files appear under `src/sidepanel/components/ui/` (`button.tsx`, `dialog.tsx`, `select.tsx`, `textarea.tsx`, `scroll-area.tsx`, `spinner.tsx`), with imports rewritten to `@/lib/utils` and `@/components/ui/*`. The CLI may add `@base-ui/react` (already installed in Task 0).

- [ ] **Step 4: FALLBACK — if the CLI fails in this environment**

If `bunx shadcn` errors (network/interactive/registry-key issues), fetch the registry JSON directly and write the files. Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
mkdir -p src/sidepanel/components/ui
for c in button dialog select textarea scroll-area spinner; do
  curl -fsSL "https://coss.com/ui/r/$c.json" \
    | bun -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const f of j.files){let code=f.content.replace(/@\/registry\/default\/lib\/utils/g,"@/lib/utils").replace(/@\/registry\/default\/ui\//g,"@/components/ui/");const name=f.path.split("/").pop();require("fs").writeFileSync("src/sidepanel/components/ui/"+name,code);console.error("wrote",name);}})'
done
```
Expected: same six files written with corrected import prefixes. (`@coss/dialog` depends on `scroll-area`, already in the list.)

- [ ] **Step 5: Typecheck**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run typecheck
```
Expected: no errors. If a component imports a subpath of `@base-ui/react` that fails to resolve, confirm `@base-ui/react` is installed (`bun pm ls | grep @base-ui`); it provides subpath exports like `@base-ui/react/dialog`.

- [ ] **Step 6: Build to confirm Tailwind compiles the components**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run build
```
Expected: success; CSS asset includes the component utility classes.

- [ ] **Step 7: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/components.json packages/extension/src/sidepanel/lib/utils.ts packages/extension/src/sidepanel/components/ui packages/extension/package.json bun.lock
git commit -m "feat(extension): add coss UI components + cn() util"
```

---

## Task 4: Key-value storage abstraction (TDD)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/kv.ts`
- Test: `packages/extension/test/kv.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/kv.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/kv.ts";

describe("MemoryKv", () => {
  test("get returns undefined for missing key", async () => {
    const kv = new MemoryKv();
    expect(await kv.get("missing")).toBeUndefined();
  });

  test("set then get round-trips a value", async () => {
    const kv = new MemoryKv();
    await kv.set("k", { a: 1 });
    expect(await kv.get("k")).toEqual({ a: 1 });
  });

  test("remove deletes a key", async () => {
    const kv = new MemoryKv();
    await kv.set("k", 1);
    await kv.remove("k");
    expect(await kv.get("k")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/kv.test.ts
```
Expected: FAIL — cannot find module `kv.ts`.

- [ ] **Step 3: Implement `kv.ts`**

Create `packages/extension/src/sidepanel/lib/kv.ts`:
```ts
/** Minimal async key-value interface, backed by chrome.storage.local in prod. */
export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** In-memory implementation for tests. */
export class MemoryKv implements Kv {
  private readonly map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** chrome.storage.local-backed implementation for the extension runtime. */
export class ChromeKv implements Kv {
  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}

/** Default store used by the app (overridable in tests). */
export const defaultKv: Kv = new ChromeKv();
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/kv.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/lib/kv.ts packages/extension/test/kv.test.ts
git commit -m "feat(extension): key-value storage abstraction"
```

---

## Task 5: Auth store — credential CRUD + token resolution (TDD)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/authStore.ts`
- Test: `packages/extension/test/authStore.test.ts`

This stores per-provider credentials shaped like pi's `auth.json` entries and resolves a usable token for a provider, refreshing expired OAuth tokens. The refresh function is injected so it can be tested without network.

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/authStore.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/kv.ts";
import { AuthStore } from "../src/sidepanel/lib/authStore.ts";
import type { OAuthCredential } from "../src/sidepanel/lib/authStore.ts";

describe("AuthStore", () => {
  test("stores and lists api-key credentials", async () => {
    const store = new AuthStore(new MemoryKv());
    await store.setApiKey("openrouter", "sk-or-123");
    expect(await store.listProviders()).toEqual(["openrouter"]);
    expect(await store.get("openrouter")).toEqual({ type: "api_key", key: "sk-or-123" });
  });

  test("remove deletes a provider", async () => {
    const store = new AuthStore(new MemoryKv());
    await store.setApiKey("groq", "gsk_1");
    await store.remove("groq");
    expect(await store.listProviders()).toEqual([]);
  });

  test("getToken returns the api key for api-key creds", async () => {
    const store = new AuthStore(new MemoryKv());
    await store.setApiKey("openrouter", "sk-or-123");
    expect(await store.getToken("openrouter")).toBe("sk-or-123");
  });

  test("getToken returns the access token when oauth is unexpired", async () => {
    const store = new AuthStore(new MemoryKv());
    const cred: OAuthCredential = {
      type: "oauth",
      access: "sk-ant-oat-fresh",
      refresh: "r1",
      expires: Date.now() + 60_000,
    };
    await store.setOAuth("anthropic", cred);
    expect(await store.getToken("anthropic")).toBe("sk-ant-oat-fresh");
  });

  test("getToken refreshes and persists when oauth is expired", async () => {
    const kv = new MemoryKv();
    const store = new AuthStore(kv);
    await store.setOAuth("anthropic", {
      type: "oauth",
      access: "old",
      refresh: "r1",
      expires: Date.now() - 1,
    });
    let refreshCalledWith = "";
    store.setRefresher(async (refresh) => {
      refreshCalledWith = refresh;
      return { type: "oauth", access: "sk-ant-oat-new", refresh: "r2", expires: Date.now() + 60_000 };
    });
    expect(await store.getToken("anthropic")).toBe("sk-ant-oat-new");
    expect(refreshCalledWith).toBe("r1");
    // persisted
    expect(await store.get("anthropic")).toMatchObject({ access: "sk-ant-oat-new", refresh: "r2" });
  });

  test("getToken returns undefined for unknown provider", async () => {
    const store = new AuthStore(new MemoryKv());
    expect(await store.getToken("openai")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/authStore.test.ts
```
Expected: FAIL — cannot find module `authStore.ts`.

- [ ] **Step 3: Implement `authStore.ts`**

Create `packages/extension/src/sidepanel/lib/authStore.ts`:
```ts
import type { Kv } from "./kv.ts";
import { defaultKv } from "./kv.ts";

const KEY = "obc:auth";

export interface ApiKeyCredential {
  type: "api_key";
  key: string;
}

export interface OAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  /** epoch ms; treated as expired when Date.now() >= expires */
  expires: number;
}

export type Credential = ApiKeyCredential | OAuthCredential;

type AuthBlob = Record<string, Credential>;

/** Refreshes an OAuth credential given its refresh token. Injected for testing. */
export type Refresher = (refresh: string) => Promise<OAuthCredential>;

export class AuthStore {
  private refresher?: Refresher;

  constructor(private readonly kv: Kv = defaultKv) {}

  setRefresher(refresher: Refresher): void {
    this.refresher = refresher;
  }

  private async readAll(): Promise<AuthBlob> {
    return ((await this.kv.get(KEY)) as AuthBlob | undefined) ?? {};
  }

  private async writeAll(blob: AuthBlob): Promise<void> {
    await this.kv.set(KEY, blob);
  }

  async listProviders(): Promise<string[]> {
    return Object.keys(await this.readAll());
  }

  async get(provider: string): Promise<Credential | undefined> {
    return (await this.readAll())[provider];
  }

  async setApiKey(provider: string, key: string): Promise<void> {
    const blob = await this.readAll();
    blob[provider] = { type: "api_key", key };
    await this.writeAll(blob);
  }

  async setOAuth(provider: string, cred: OAuthCredential): Promise<void> {
    const blob = await this.readAll();
    blob[provider] = cred;
    await this.writeAll(blob);
  }

  async remove(provider: string): Promise<void> {
    const blob = await this.readAll();
    delete blob[provider];
    await this.writeAll(blob);
  }

  /**
   * Resolve a usable token for the provider. For OAuth, refreshes (and persists)
   * when expired. The returned string is passed to pi as `apiKey`; Anthropic
   * OAuth access tokens contain "sk-ant-oat" so pi auto-uses Bearer auth.
   */
  async getToken(provider: string): Promise<string | undefined> {
    const cred = await this.get(provider);
    if (!cred) return undefined;
    if (cred.type === "api_key") return cred.key;
    if (Date.now() < cred.expires) return cred.access;
    if (!this.refresher) return cred.access; // best effort; let the call 401
    const refreshed = await this.refresher(cred.refresh);
    await this.setOAuth(provider, refreshed);
    return refreshed.access;
  }
}

/** App-wide singleton used by the UI. */
export const authStore = new AuthStore();
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/authStore.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/lib/authStore.ts packages/extension/test/authStore.test.ts
git commit -m "feat(extension): auth store with OAuth refresh"
```

---

## Task 6: Settings store — selected provider/model (TDD)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/settingsStore.ts`
- Test: `packages/extension/test/settingsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/settingsStore.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/kv.ts";
import { SettingsStore } from "../src/sidepanel/lib/settingsStore.ts";

describe("SettingsStore", () => {
  test("returns empty selection by default", async () => {
    const store = new SettingsStore(new MemoryKv());
    expect(await store.getSelection()).toEqual({ provider: undefined, model: undefined });
  });

  test("persists provider and model selection", async () => {
    const kv = new MemoryKv();
    const store = new SettingsStore(kv);
    await store.setSelection("openrouter", "anthropic/claude-3.5-haiku");
    expect(await store.getSelection()).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });
    // survives a fresh instance over the same kv
    const store2 = new SettingsStore(kv);
    expect((await store2.getSelection()).provider).toBe("openrouter");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/settingsStore.test.ts
```
Expected: FAIL — cannot find module `settingsStore.ts`.

- [ ] **Step 3: Implement `settingsStore.ts`**

Create `packages/extension/src/sidepanel/lib/settingsStore.ts`:
```ts
import type { Kv } from "./kv.ts";
import { defaultKv } from "./kv.ts";

const KEY = "obc:settings";

export interface Selection {
  provider: string | undefined;
  model: string | undefined;
}

interface SettingsBlob {
  defaultProvider?: string;
  defaultModel?: string;
}

export class SettingsStore {
  constructor(private readonly kv: Kv = defaultKv) {}

  async getSelection(): Promise<Selection> {
    const blob = ((await this.kv.get(KEY)) as SettingsBlob | undefined) ?? {};
    return { provider: blob.defaultProvider, model: blob.defaultModel };
  }

  async setSelection(provider: string, model: string): Promise<void> {
    await this.kv.set(KEY, { defaultProvider: provider, defaultModel: model });
  }
}

export const settingsStore = new SettingsStore();
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/settingsStore.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/lib/settingsStore.ts packages/extension/test/settingsStore.test.ts
git commit -m "feat(extension): settings store for provider/model selection"
```

---

## Task 7: Provider catalog + model listing (TDD)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/providers.ts`
- Test: `packages/extension/test/providers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/providers.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { CURATED_PROVIDERS, getProviderMeta, listModels } from "../src/sidepanel/lib/providers.ts";

describe("providers catalog", () => {
  test("includes the seven curated providers with openrouter first", () => {
    const slugs = CURATED_PROVIDERS.map((p) => p.slug);
    expect(slugs[0]).toBe("openrouter");
    expect(slugs).toEqual(
      expect.arrayContaining(["openrouter", "openai", "anthropic", "google", "groq", "xai", "deepseek"]),
    );
  });

  test("only anthropic supports the oauth method", () => {
    const oauthProviders = CURATED_PROVIDERS.filter((p) => p.authMethods.includes("oauth")).map((p) => p.slug);
    expect(oauthProviders).toEqual(["anthropic"]);
  });

  test("getProviderMeta resolves a known slug", () => {
    expect(getProviderMeta("openrouter")?.name).toBe("OpenRouter");
    expect(getProviderMeta("nope")).toBeUndefined();
  });

  test("listModels returns non-empty model lists with id+name for each provider", () => {
    for (const p of CURATED_PROVIDERS) {
      const models = listModels(p.slug);
      expect(models.length).toBeGreaterThan(0);
      expect(typeof models[0]!.id).toBe("string");
      expect(typeof models[0]!.name).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/providers.test.ts
```
Expected: FAIL — cannot find module `providers.ts`.

- [ ] **Step 3: Implement `providers.ts`**

Create `packages/extension/src/sidepanel/lib/providers.ts`:
```ts
import { getModels } from "@earendil-works/pi-ai";
import type { KnownProvider, Model, Api } from "@earendil-works/pi-ai";

export type AuthMethod = "api_key" | "oauth";

export interface ProviderMeta {
  slug: KnownProvider;
  name: string;
  authMethods: AuthMethod[];
  /** Where the user gets an API key (shown in the connect dialog). */
  apiKeyUrl?: string;
}

/** OpenRouter first (the north star); anthropic also supports subscription OAuth. */
export const CURATED_PROVIDERS: ProviderMeta[] = [
  { slug: "openrouter", name: "OpenRouter", authMethods: ["api_key"], apiKeyUrl: "https://openrouter.ai/keys" },
  { slug: "openai", name: "OpenAI", authMethods: ["api_key"], apiKeyUrl: "https://platform.openai.com/api-keys" },
  { slug: "anthropic", name: "Anthropic", authMethods: ["api_key", "oauth"], apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  { slug: "google", name: "Google Gemini", authMethods: ["api_key"], apiKeyUrl: "https://aistudio.google.com/apikey" },
  { slug: "groq", name: "Groq", authMethods: ["api_key"], apiKeyUrl: "https://console.groq.com/keys" },
  { slug: "xai", name: "xAI", authMethods: ["api_key"], apiKeyUrl: "https://console.x.ai" },
  { slug: "deepseek", name: "DeepSeek", authMethods: ["api_key"], apiKeyUrl: "https://platform.deepseek.com/api_keys" },
];

export function getProviderMeta(slug: string): ProviderMeta | undefined {
  return CURATED_PROVIDERS.find((p) => p.slug === slug);
}

/** Models for a provider, sorted by display name, from pi's static catalog. */
export function listModels(slug: KnownProvider): Model<Api>[] {
  return [...getModels(slug)].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/providers.test.ts
```
Expected: PASS (4 tests). If `getModels(slug)` types complain about `KnownProvider`, confirm the slug literals match pi's `KnownProvider` union (they are verified to: `openrouter|openai|anthropic|google|groq|xai|deepseek`).

- [ ] **Step 5: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/lib/providers.ts packages/extension/test/providers.test.ts
git commit -m "feat(extension): curated provider catalog + model listing"
```

---

## Task 8: Anthropic OAuth module (TDD)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/oauthAnthropic.ts`
- Test: `packages/extension/test/oauthAnthropic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/test/oauthAnthropic.test.ts`:
```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  generatePkce,
  buildAuthorizeUrl,
  parseRedirect,
  exchangeCode,
  refreshToken,
  ANTHROPIC_OAUTH,
} from "../src/sidepanel/lib/oauthAnthropic.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("anthropic oauth", () => {
  test("generatePkce returns base64url verifier+challenge", async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toBe(challenge);
  });

  test("buildAuthorizeUrl includes all required params and code=true", () => {
    const url = new URL(buildAuthorizeUrl({ verifier: "VER", challenge: "CHAL" }));
    expect(url.origin + url.pathname).toBe(ANTHROPIC_OAUTH.authorizeUrl);
    const p = url.searchParams;
    expect(p.get("code")).toBe("true");
    expect(p.get("client_id")).toBe(ANTHROPIC_OAUTH.clientId);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("redirect_uri")).toBe(ANTHROPIC_OAUTH.redirectUri);
    expect(p.get("scope")).toBe(ANTHROPIC_OAUTH.scopes);
    expect(p.get("code_challenge")).toBe("CHAL");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBe("VER");
  });

  test("parseRedirect handles a full URL", () => {
    expect(parseRedirect("http://localhost:53692/callback?code=AC&state=ST")).toEqual({
      code: "AC",
      state: "ST",
    });
  });

  test("parseRedirect handles code#state", () => {
    expect(parseRedirect("AC#ST")).toEqual({ code: "AC", state: "ST" });
  });

  test("parseRedirect handles a bare code", () => {
    expect(parseRedirect("  AC  ")).toEqual({ code: "AC", state: undefined });
  });

  test("exchangeCode posts the correct body and maps the response", async () => {
    let captured: { url: string; body: unknown } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string) };
      return new Response(
        JSON.stringify({ access_token: "sk-ant-oat-A", refresh_token: "R", expires_in: 3600 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const before = Date.now();
    const cred = await exchangeCode({ code: "AC", state: "VER", verifier: "VER" });
    expect(captured?.url).toBe(ANTHROPIC_OAUTH.tokenUrl);
    expect(captured?.body).toEqual({
      grant_type: "authorization_code",
      client_id: ANTHROPIC_OAUTH.clientId,
      code: "AC",
      state: "VER",
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      code_verifier: "VER",
    });
    expect(cred.type).toBe("oauth");
    expect(cred.access).toBe("sk-ant-oat-A");
    expect(cred.refresh).toBe("R");
    // expires ~ now + 3600s - 5min buffer
    expect(cred.expires).toBeGreaterThan(before + 3600_000 - 300_000 - 5_000);
    expect(cred.expires).toBeLessThan(before + 3600_000 - 300_000 + 5_000);
  });

  test("refreshToken posts refresh_token grant without scope", async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ access_token: "sk-ant-oat-B", refresh_token: "R2", expires_in: 3600 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const cred = await refreshToken("R");
    expect(body).toEqual({
      grant_type: "refresh_token",
      client_id: ANTHROPIC_OAUTH.clientId,
      refresh_token: "R",
    });
    expect(body).not.toHaveProperty("scope");
    expect(cred.access).toBe("sk-ant-oat-B");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/oauthAnthropic.test.ts
```
Expected: FAIL — cannot find module `oauthAnthropic.ts`.

- [ ] **Step 3: Implement `oauthAnthropic.ts`**

Create `packages/extension/src/sidepanel/lib/oauthAnthropic.ts`:
```ts
import type { OAuthCredential } from "./authStore.ts";

export const ANTHROPIC_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri: "http://localhost:53692/callback",
  scopes:
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
} as const;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** PKCE via Web Crypto (browser-safe). */
export async function generatePkce(): Promise<Pkce> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

/** Authorize URL; the PKCE verifier doubles as the state param. */
export function buildAuthorizeUrl(pkce: Pkce): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_OAUTH.clientId,
    response_type: "code",
    redirect_uri: ANTHROPIC_OAUTH.redirectUri,
    scope: ANTHROPIC_OAUTH.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.verifier,
  });
  return `${ANTHROPIC_OAUTH.authorizeUrl}?${params.toString()}`;
}

export interface ParsedRedirect {
  code: string;
  state: string | undefined;
}

/**
 * Extract code + state from the user's pasted input. Supports:
 *  - full redirect URL (http://localhost:53692/callback?code=..&state=..)
 *  - "code#state"
 *  - "code=..&state=.."
 *  - a bare code
 */
export function parseRedirect(input: string): ParsedRedirect {
  const trimmed = input.trim();
  if (trimmed.includes("://")) {
    const url = new URL(trimmed);
    return { code: url.searchParams.get("code") ?? "", state: url.searchParams.get("state") ?? undefined };
  }
  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#");
    return { code: code ?? "", state: state || undefined };
  }
  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed);
    return { code: params.get("code") ?? "", state: params.get("state") ?? undefined };
  }
  return { code: trimmed, state: undefined };
}

async function postJson(url: string, body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OAuth HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

function toCredential(data: { access_token: string; refresh_token: string; expires_in: number }): OAuthCredential {
  return {
    type: "oauth",
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

export async function exchangeCode(opts: {
  code: string;
  state: string;
  verifier: string;
}): Promise<OAuthCredential> {
  const data = await postJson(ANTHROPIC_OAUTH.tokenUrl, {
    grant_type: "authorization_code",
    client_id: ANTHROPIC_OAUTH.clientId,
    code: opts.code,
    state: opts.state,
    redirect_uri: ANTHROPIC_OAUTH.redirectUri,
    code_verifier: opts.verifier,
  });
  return toCredential(data);
}

export async function refreshToken(refresh: string): Promise<OAuthCredential> {
  const data = await postJson(ANTHROPIC_OAUTH.tokenUrl, {
    grant_type: "refresh_token",
    client_id: ANTHROPIC_OAUTH.clientId,
    refresh_token: refresh,
  });
  return toCredential(data);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/oauthAnthropic.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/lib/oauthAnthropic.ts packages/extension/test/oauthAnthropic.test.ts
git commit -m "feat(extension): browser-safe Anthropic OAuth (PKCE, exchange, refresh)"
```

---

## Task 9: ChatSession — pi Agent wrapper (TDD-light)

**Files:**
- Create: `packages/extension/src/sidepanel/lib/chat.ts`
- Test: `packages/extension/test/chat.test.ts`

`ChatSession` wraps pi's `Agent`, exposes a UI-friendly view (`{role, text}[]`), a `subscribe` for re-renders, `send`, `setModel`, and `abort`. Credentials resolve via the injected `getToken`. A `streamFn` override is accepted for tests.

- [ ] **Step 1: Write the test**

Create `packages/extension/test/chat.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { getModels } from "@earendil-works/pi-ai";
import { ChatSession } from "../src/sidepanel/lib/chat.ts";

const model = getModels("openrouter")[0]!;

describe("ChatSession", () => {
  test("constructs with a model and exposes an empty view", () => {
    const session = new ChatSession({
      model,
      getToken: async () => "sk-or-test",
    });
    expect(session.getMessages()).toEqual([]);
    expect(session.isStreaming()).toBe(false);
  });

  test("setModel swaps the active model", () => {
    const session = new ChatSession({ model, getToken: async () => "k" });
    const other = getModels("groq")[0]!;
    session.setModel(other);
    expect(session.currentModel().id).toBe(other.id);
  });

  // Live end-to-end test — skipped unless OPENROUTER_API_KEY is set.
  // Run with: OPENROUTER_API_KEY=sk-or-... bun test test/chat.test.ts
  test.skipIf(!process.env.OPENROUTER_API_KEY)(
    "streams a real reply from OpenRouter",
    async () => {
      const liveModel =
        getModels("openrouter").find((m) => m.id === "openai/gpt-4o-mini") ?? getModels("openrouter")[0]!;
      const session = new ChatSession({
        model: liveModel,
        getToken: async () => process.env.OPENROUTER_API_KEY!,
        systemPrompt: "Reply with exactly the word: pong",
      });
      await session.send("ping");
      const msgs = session.getMessages();
      const assistant = msgs.findLast((m) => m.role === "assistant");
      expect(assistant?.text.toLowerCase()).toContain("pong");
    },
    30_000,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/chat.test.ts
```
Expected: FAIL — cannot find module `chat.ts`.

- [ ] **Step 3: Implement `chat.ts`**

Create `packages/extension/src/sidepanel/lib/chat.ts`:
```ts
import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model, Api, AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export type ChatRole = "user" | "assistant";

export interface ChatMessageView {
  role: ChatRole;
  text: string;
}

export interface ChatSessionOptions {
  model: Model<Api>;
  getToken: (provider: string) => Promise<string | undefined> | string | undefined;
  systemPrompt?: string;
  /** Test-only override of the LLM call. Production omits it (uses pi's default). */
  streamFn?: StreamFn;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

/** Join the text parts of an LLM message into a plain string. */
function messageText(content: AssistantMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class ChatSession {
  private readonly agent: Agent;
  private readonly listeners = new Set<() => void>();

  constructor(options: ChatSessionOptions) {
    this.agent = new Agent({
      initialState: {
        model: options.model,
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        thinkingLevel: "off",
        tools: [],
      },
      getApiKey: (provider) => options.getToken(provider),
      ...(options.streamFn ? { streamFn: options.streamFn } : {}),
    });

    // Re-emit every agent event as a generic "changed" signal for React.
    this.agent.subscribe(() => {
      for (const listener of this.listeners) listener();
    });
  }

  /** Subscribe to state changes (for React re-render). Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  currentModel(): Model<Api> {
    return this.agent.state.model;
  }

  setModel(model: Model<Api>): void {
    this.agent.state.model = model;
    for (const listener of this.listeners) listener();
  }

  isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  error(): string | undefined {
    return this.agent.state.errorMessage;
  }

  /** UI view of the conversation, including the in-flight streaming reply. */
  getMessages(): ChatMessageView[] {
    const views: ChatMessageView[] = [];
    for (const msg of this.agent.state.messages) {
      if (msg.role === "user") views.push({ role: "user", text: messageText(msg.content) });
      else if (msg.role === "assistant") views.push({ role: "assistant", text: messageText(msg.content) });
    }
    const streaming = this.agent.state.streamingMessage;
    if (streaming && streaming.role === "assistant") {
      views.push({ role: "assistant", text: messageText(streaming.content) });
    }
    return views;
  }

  /** Send a user message and await the assistant turn. No-op while streaming. */
  async send(text: string): Promise<void> {
    if (this.agent.state.isStreaming) return;
    await this.agent.prompt(text);
  }

  abort(): void {
    this.agent.abort();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test test/chat.test.ts
```
Expected: PASS (2 ran, 1 skipped). If `StreamFn` is not exported from `@earendil-works/pi-agent-core`, change the import to `import type { StreamFn } from "@earendil-works/pi-ai";` (the type originates in pi-ai) — verify which package re-exports it via `bun pm ls` / the `.d.ts`.

- [ ] **Step 5: (Optional) live check**

If you have an OpenRouter key:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
OPENROUTER_API_KEY=sk-or-... bun test test/chat.test.ts
```
Expected: the live test runs and the assistant reply contains "pong".

- [ ] **Step 6: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/lib/chat.ts packages/extension/test/chat.test.ts
git commit -m "feat(extension): ChatSession wrapping pi Agent"
```

---

## Task 10: Connect-provider dialog + empty state (UI)

**Files:**
- Create: `packages/extension/src/sidepanel/components/EmptyState.tsx`
- Create: `packages/extension/src/sidepanel/components/ConnectProviderDialog.tsx`

The dialog mirrors pi's `/login`: two tabs — **API key** (all 7 providers) and **Subscription** (Anthropic). On success it stores the credential, sets the default provider+model, and calls `onConnected`.

- [ ] **Step 1: Create `EmptyState.tsx`**

Create `packages/extension/src/sidepanel/components/EmptyState.tsx`:
```tsx
import { Button } from "@/components/ui/button";

export function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <h1 className="text-base font-semibold">Open Browser Control</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a provider to start chatting.
        </p>
      </div>
      <Button onClick={onConnect}>Connect a provider</Button>
    </div>
  );
}
```

- [ ] **Step 2: Create `ConnectProviderDialog.tsx`**

Create `packages/extension/src/sidepanel/components/ConnectProviderDialog.tsx`:
```tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURATED_PROVIDERS, getProviderMeta, listModels } from "@/lib/providers";
import { authStore } from "@/lib/authStore";
import { settingsStore } from "@/lib/settingsStore";
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  parseRedirect,
  type Pkce,
} from "@/lib/oauthAnthropic";
import type { KnownProvider } from "@earendil-works/pi-ai";

type Tab = "api_key" | "oauth";

const API_KEY_PROVIDERS = CURATED_PROVIDERS;
const OAUTH_PROVIDERS = CURATED_PROVIDERS.filter((p) => p.authMethods.includes("oauth"));

async function defaultModelFor(provider: KnownProvider): Promise<string> {
  const models = listModels(provider);
  return models[0]?.id ?? "";
}

export function ConnectProviderDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [tab, setTab] = useState<Tab>("api_key");

  // API-key state
  const [provider, setProvider] = useState<string>(API_KEY_PROVIDERS[0]!.slug);
  const [apiKey, setApiKey] = useState("");

  // OAuth state
  const [oauthProvider] = useState<string>(OAUTH_PROVIDERS[0]?.slug ?? "anthropic");
  const [pkce, setPkce] = useState<Pkce | undefined>();
  const [pasted, setPasted] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function finish(slug: KnownProvider) {
    await settingsStore.setSelection(slug, await defaultModelFor(slug));
    setBusy(false);
    setError(undefined);
    setApiKey("");
    setPasted("");
    setPkce(undefined);
    onOpenChange(false);
    onConnected();
  }

  async function connectApiKey() {
    setError(undefined);
    const key = apiKey.trim();
    if (!key) {
      setError("Enter an API key.");
      return;
    }
    setBusy(true);
    try {
      await authStore.setApiKey(provider, key);
      await finish(provider as KnownProvider);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startOAuth() {
    setError(undefined);
    const generated = await generatePkce();
    setPkce(generated);
    await chrome.tabs.create({ url: buildAuthorizeUrl(generated) });
  }

  async function completeOAuth() {
    setError(undefined);
    if (!pkce) {
      setError("Start the sign-in first.");
      return;
    }
    const { code, state } = parseRedirect(pasted);
    if (!code) {
      setError("Could not find an authorization code in what you pasted.");
      return;
    }
    setBusy(true);
    try {
      const cred = await exchangeCode({ code, state: state ?? pkce.verifier, verifier: pkce.verifier });
      await authStore.setOAuth(oauthProvider, cred);
      await finish(oauthProvider as KnownProvider);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const meta = getProviderMeta(provider);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a provider</DialogTitle>
          <DialogDescription>Use an API key, or sign in with a subscription.</DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex gap-2">
          <Button variant={tab === "api_key" ? "default" : "secondary"} onClick={() => setTab("api_key")}>
            API key
          </Button>
          <Button variant={tab === "oauth" ? "default" : "secondary"} onClick={() => setTab("oauth")}>
            Subscription
          </Button>
        </div>

        {tab === "api_key" ? (
          <div className="flex flex-col gap-3">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {API_KEY_PROVIDERS.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Paste your API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              rows={2}
            />
            {meta?.apiKeyUrl && (
              <a className="text-xs text-muted-foreground underline" href={meta.apiKeyUrl} target="_blank" rel="noreferrer">
                Get a {meta.name} API key
              </a>
            )}
            <Button onClick={connectApiKey} disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Sign in to <strong>Anthropic (Claude Pro/Max)</strong>. A tab opens; after approving you'll be
              redirected to a page that won't load — copy that page's full URL (or the code Claude shows) and
              paste it below.
            </p>
            <Button onClick={startOAuth} disabled={busy}>
              Open Claude sign-in
            </Button>
            <Textarea
              placeholder="Paste the redirect URL or code"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={2}
              disabled={!pkce}
            />
            <Button onClick={completeOAuth} disabled={busy || !pkce}>
              {busy ? "Finishing…" : "Finish sign-in"}
            </Button>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run typecheck
```
Expected: no errors. **If the coss component prop names differ** (e.g. `Button`'s `variant` values, or the `Select`/`Dialog` subcomponent export names), open the generated files under `src/sidepanel/components/ui/` and adjust the imports/props to match — the coss/shadcn API uses `Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription`, `Select/SelectTrigger/SelectValue/SelectContent/SelectItem`, `Button` (with a `variant` prop), and `Textarea`. Fix any mismatch inline.

- [ ] **Step 4: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel/components/EmptyState.tsx packages/extension/src/sidepanel/components/ConnectProviderDialog.tsx
git commit -m "feat(extension): connect-provider dialog + empty state"
```

---

## Task 11: Provider/model selector, chat view, and App wiring (UI)

**Files:**
- Create: `packages/extension/src/sidepanel/components/ProviderModelSelector.tsx`
- Create: `packages/extension/src/sidepanel/components/Chat.tsx`
- Modify: `packages/extension/src/sidepanel/App.tsx`

- [ ] **Step 1: Create `ProviderModelSelector.tsx`**

Create `packages/extension/src/sidepanel/components/ProviderModelSelector.tsx`:
```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getProviderMeta, listModels } from "@/lib/providers";
import type { KnownProvider } from "@earendil-works/pi-ai";

export function ProviderModelSelector({
  connectedProviders,
  provider,
  model,
  onChange,
}: {
  connectedProviders: string[];
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
}) {
  const models = listModels(provider as KnownProvider);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={provider}
        onValueChange={(p) => {
          const first = listModels(p as KnownProvider)[0]?.id ?? "";
          onChange(p, first);
        }}
      >
        <SelectTrigger className="h-8 w-[120px] text-xs">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          {connectedProviders.map((slug) => (
            <SelectItem key={slug} value={slug}>
              {getProviderMeta(slug)?.name ?? slug}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={model} onValueChange={(m) => onChange(provider, m)}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: Create `Chat.tsx`**

Create `packages/extension/src/sidepanel/components/Chat.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatSession } from "@/lib/chat";
import { cn } from "@/lib/utils";

export function Chat({ session }: { session: ChatSession }) {
  const [, force] = useState(0);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => session.subscribe(() => force((n) => n + 1)), [session]);

  const messages = session.getMessages();
  const streaming = session.isStreaming();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await session.send(text);
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-secondary text-secondary-foreground",
              )}
            >
              {m.text || (m.role === "assistant" && streaming ? "…" : "")}
            </div>
          ))}
          {session.error() && <p className="text-sm text-destructive">{session.error()}</p>}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
          className="min-h-9 flex-1 resize-none"
          placeholder="Message…"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <Button variant="secondary" onClick={() => session.abort()}>
            Stop
          </Button>
        ) : (
          <Button onClick={() => void send()} disabled={!input.trim()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `App.tsx` to wire everything together**

Overwrite `packages/extension/src/sidepanel/App.tsx`:
```tsx
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ConnectProviderDialog } from "@/components/ConnectProviderDialog";
import { ProviderModelSelector } from "@/components/ProviderModelSelector";
import { Chat } from "@/components/Chat";
import { Button } from "@/components/ui/button";
import { authStore } from "@/lib/authStore";
import { settingsStore } from "@/lib/settingsStore";
import { listModels } from "@/lib/providers";
import { refreshToken } from "@/lib/oauthAnthropic";
import { ChatSession } from "@/lib/chat";
import type { KnownProvider } from "@earendil-works/pi-ai";

// Wire OAuth refresh into the shared auth store once.
authStore.setRefresher(refreshToken);

export function App() {
  const [connected, setConnected] = useState<string[] | undefined>();
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  async function reload() {
    const providers = await authStore.listProviders();
    setConnected(providers);
    const sel = await settingsStore.getSelection();
    if (sel.provider && providers.includes(sel.provider)) {
      setProvider(sel.provider);
      setModel(sel.model ?? listModels(sel.provider as KnownProvider)[0]?.id ?? "");
    } else if (providers[0]) {
      setProvider(providers[0]);
      setModel(listModels(providers[0] as KnownProvider)[0]?.id ?? "");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // Re-create the chat session whenever provider/model changes.
  const session = useMemo(() => {
    if (!provider || !model) return undefined;
    const m = listModels(provider as KnownProvider).find((x) => x.id === model);
    if (!m) return undefined;
    return new ChatSession({ model: m, getToken: (p) => authStore.getToken(p) });
  }, [provider, model]);

  if (connected === undefined) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (connected.length === 0) {
    return (
      <>
        <EmptyState onConnect={() => setDialogOpen(true)} />
        <ConnectProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} onConnected={reload} />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b p-2">
        <ProviderModelSelector
          connectedProviders={connected}
          provider={provider}
          model={model}
          onChange={async (p, m) => {
            setProvider(p);
            setModel(m);
            await settingsStore.setSelection(p, m);
          }}
        />
        <Button variant="secondary" className="h-8 text-xs" onClick={() => setDialogOpen(true)}>
          + Provider
        </Button>
      </header>

      {session ? (
        <div className="min-h-0 flex-1">
          <Chat key={`${provider}:${model}`} session={session} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a provider and model.
        </div>
      )}

      <ConnectProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} onConnected={reload} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun run typecheck && bun run build
```
Expected: both succeed. Fix any coss component prop/name mismatches inline (see Task 10 Step 3 note).

- [ ] **Step 5: Manual end-to-end (API key)**

Reload the unpacked extension. Click the icon → tab is grouped, panel opens → empty state. Click **Connect a provider** → API key tab → choose **OpenRouter** → paste a real key → **Connect**. The chat view appears with OpenRouter + a model selected top-left. Type "say hello" → Enter → a streamed reply appears. Switch the model dropdown and send again. Click **+ Provider** to add another.

- [ ] **Step 6: Manual end-to-end (Anthropic subscription, if you have Claude Pro/Max)**

Connect dialog → **Subscription** tab → **Open Claude sign-in** → approve in the opened tab → copy the failed-redirect URL (or the displayed code) → paste → **Finish sign-in**. Anthropic appears as a connected provider; select it and chat. (The assistant runs under the Claude Code identity prefix that pi injects for OAuth — expected.)

- [ ] **Step 7: Commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add packages/extension/src/sidepanel
git commit -m "feat(extension): provider/model selectors, chat view, app wiring"
```

---

## Task 12: Full test pass, docs, and final commit

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full extension test suite**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control/packages/extension
bun test
```
Expected: all suites pass (kv, authStore, settingsStore, providers, oauthAnthropic, chat — with the live chat test skipped).

- [ ] **Step 2: Workspace typecheck**

Run:
```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
bun run typecheck
```
Expected: all packages pass.

- [ ] **Step 3: Update the README status + usage**

In `README.md`, replace the `> **Status:** buildable skeleton...` blockquote (around lines 13-15) with:
```markdown
> **Status:** in-browser chat works. Click the toolbar icon to group the current
> tab and open the side-panel chat; connect a provider (API key for all, Anthropic
> Claude Pro/Max via subscription OAuth), pick a provider+model, and chat. Browser-
> control tools (MCP / native host) are the next phase and not wired yet.
```
And under "### Chrome extension" add:
```markdown
The chat panel uses the [pi](https://github.com/earendil-works/pi) agent runtime
(`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`) directly in the browser.
Credentials are stored in `chrome.storage.local`.
```

- [ ] **Step 4: Final commit**

```bash
cd /Users/nosferatu/Projects/personal/open-browser-control
git add README.md
git commit -m "docs: document in-panel chat + provider management"
```

- [ ] **Step 5: (Optional) push the branch**

Only if the user asks. The branch is `feat/sidepanel-chat`.

---

## Self-review notes (resolved during authoring)

- **Spec coverage:** icon→group→panel (Task 2) · connect button/empty state (Task 10) · connect provider like pi: API key for all + Anthropic OAuth (Tasks 8, 10) · credential storage (Tasks 4, 5) · provider+model selectors top-left (Task 11) · chat send/stream (Tasks 9, 11) · coss UI (Task 3) · ephemeral history (ChatSession is recreated per provider/model change and not persisted — Task 9/11) · no tools (Agent constructed with `tools: []`).
- **Type consistency:** `Kv` interface used by `AuthStore`/`SettingsStore`; `Credential`/`OAuthCredential` shared by `authStore` ↔ `oauthAnthropic` ↔ `chat` token path; `getToken(provider)` signature matches `ChatSession.getToken` and `Agent.getApiKey`; provider slugs (`openrouter|openai|anthropic|google|groq|xai|deepseek`) consistent across `providers.ts`, dialog, and selector.
- **Known risks flagged inline (with fixes):** `@vitejs/plugin-react` × `vite@8` peer (Task 0/1) · node-dep stubs for pi-ai (Task 1) · coss CLI vs bare Vite, with curl fallback (Task 3) · coss component prop/name drift (Tasks 10/11) · `StreamFn` export location (Task 9) · Anthropic OAuth client-id/redirect acceptance is external and only verifiable live (Task 11 Step 6).
```
