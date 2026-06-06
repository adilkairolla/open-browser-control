# Open Browser Control — Project Initialization Design

**Date:** 2026-06-06
**Status:** Approved (skeleton scope)

## Purpose

`open-browser-control` is an open-source system that lets an AI client drive a real
Chrome browser. It has two halves:

- an **MCP server** that exposes browser-control tools to an MCP client
  (e.g. Claude Desktop / Claude Code), and
- a **Chrome extension** that actually performs the actions in the browser.

This document covers only the **initialization / skeleton** step: a buildable
monorepo with all configuration in place, where every component starts/builds but
no transport between the halves is wired yet.

## Transport decision: Chrome Native Messaging

The two halves communicate via **Chrome Native Messaging** (chosen over WebSocket).

Native Messaging has a lifecycle wrinkle: Chrome *launches* a registered host
executable and speaks to it over **stdio** (4-byte little-endian length prefix +
JSON). But an MCP server is itself typically launched by its client over **stdio**.
One process cannot be owned by both Chrome and an MCP client at once.

Therefore the runtime is **two cooperating processes** joined by local IPC:

```
MCP client ──stdio(MCP)──▶ mcp-server ──unix socket──▶ native-host ◀──stdio(native msg)── Chrome ◀─▶ extension
        (the client launches this)                  (Chrome launches this)
```

- `native-host` — the tiny executable Chrome launches; speaks native-messaging
  framing on stdio.
- `mcp-server` — the executable the MCP client launches; exposes tools.
- They rendezvous over a local unix socket at a shared, well-known path.

In the skeleton this IPC relay is a typed **TODO stub** — present in the structure,
not yet implemented.

## Repository structure

Bun workspaces monorepo:

```
open-browser-control/
├─ package.json                # root: Bun workspaces, aggregate scripts
├─ tsconfig.base.json          # shared TS compiler options
├─ .gitignore  .editorconfig  README.md
├─ docs/superpowers/specs/     # this design doc
└─ packages/
   ├─ shared/                  # @obc/shared — the wire contract
   │   └─ src/{protocol,framing,index}.ts
   ├─ native-host/             # @obc/native-host — executable Chrome launches
   │   ├─ src/index.ts         #   reads native-msg frames, logs; relay = TODO
   │   ├─ scripts/install.ts   #   registers the host manifest with Chrome
   │   └─ host-manifest.template.json
   ├─ mcp-server/              # @obc/mcp-server — executable the MCP client launches
   │   └─ src/index.ts         #   MCP SDK server, starts, registers 0 tools
   └─ extension/               # @obc/extension — MV3 extension
       ├─ manifest.json        #   MV3, nativeMessaging permission, blank popup
       ├─ vite.config.ts       #   vite-plugin-web-extension
       └─ src/{background.ts, popup/}
```

## Key decisions

- **Runtime / package manager:** Bun (workspaces). MCP server and native host run
  directly on Bun (TS, no build step). Extension builds via Vite.
- **`shared` is the contract:** seeded with typed RPC message unions
  (`RpcRequest` / `RpcResponse` / `RpcEvent`) and native-messaging framing helpers
  (`encodeMessage`, `FrameDecoder`), plus shared constants (host name, socket path).
  Cheap, and it defines the interface both halves will implement.
- **Extension UI:** vanilla TypeScript (lightest). A framework can be added later.
- **MCP server:** official `@modelcontextprotocol/sdk`, stdio transport, **zero
  tools** registered — it just starts cleanly.
- **Native host + relay:** real files exist (host entry, host-manifest template,
  install script) so registration is ready, but the unix-socket relay to the
  MCP server is a typed TODO. Matches "no transport wired".

## Acceptance criteria (definition of done)

1. `bun install` resolves the workspace cleanly.
2. `bun run typecheck` passes across all packages.
3. `bun run mcp` launches the MCP server; it stays up with 0 tools.
4. `bun run native-host` runs the host and reads/logs native-message frames from stdin.
5. `bun run build` produces a loadable MV3 extension in `packages/extension/dist/`.

## Explicitly out of scope (next design passes)

- The unix-socket IPC relay between `mcp-server` and `native-host`.
- `connectNative` wiring in the extension and host-manifest extension-ID pinning.
- Any real browser tools (navigate, click, screenshot, read DOM, …).
- Cross-browser (Firefox) targeting and packaging/publishing.
