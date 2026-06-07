# Open Browser Control

An open-source system that lets an AI client drive a real Chrome browser.

It has two halves:

- an **MCP server** that exposes browser-control tools to an MCP client
  (Claude Desktop / Claude Code), and
- a **Chrome extension** (MV3) that performs the actions in the browser.

They communicate over **Chrome Native Messaging**.

> **Status:** in-browser chat works. Click the toolbar icon to group the current
> tab and open the side-panel chat; connect a provider (API key for all, Anthropic
> Claude Pro/Max via subscription OAuth), pick a provider+model, and chat. Browser-
> control tools (MCP / native host) are the next phase and not wired yet. See
> [`docs/superpowers/plans/2026-06-07-extension-chat-and-providers.md`](docs/superpowers/plans/2026-06-07-extension-chat-and-providers.md).

## Architecture

Native Messaging means Chrome *launches* the host over stdio, while the MCP client
*launches* the MCP server over stdio — so they're two cooperating processes joined
by a local IPC socket:

```
MCP client ──stdio(MCP)──▶ mcp-server ──unix socket──▶ native-host ◀──stdio(native msg)── Chrome ◀─▶ extension
```

## Layout

```
packages/
  shared/       # @obc/shared — wire protocol types + native-messaging framing
  mcp-server/   # @obc/mcp-server — MCP server (the MCP client launches this)
  native-host/  # @obc/native-host — the executable Chrome launches
  extension/    # @obc/extension — MV3 extension (built with vite-plugin-web-extension)
```

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Google Chrome

## Getting started

```sh
bun install
bun run typecheck      # typecheck every package
```

### MCP server

```sh
bun run mcp            # starts the MCP server on stdio (0 tools for now)
```

### Chrome extension

```sh
bun run build          # build the extension -> packages/extension/dist/
bun run dev:extension  # build + launch Chrome with the extension loaded
```

Load the built extension manually via `chrome://extensions` → *Load unpacked* →
`packages/extension/dist`.

The chat panel uses the [pi](https://github.com/earendil-works/pi) agent runtime
(`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`) directly in the browser.
Credentials are stored in `chrome.storage.local`.

### Native messaging host (not yet wired)

```sh
bun run native-host                              # run the host, read frames from stdin
bun run install-host -- --extension-id <id>      # register the host manifest with Chrome
```

Registration requires the extension's ID (visible on `chrome://extensions` once
loaded). The host manifest's `allowed_origins` is pinned to that ID.

## License

MIT (intended).
