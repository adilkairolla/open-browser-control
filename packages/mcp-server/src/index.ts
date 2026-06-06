#!/usr/bin/env bun
/**
 * MCP server for Open Browser Control.
 *
 * Launched by an MCP client (e.g. Claude Desktop / Claude Code) over stdio. It will
 * expose browser-control tools and forward them to the Chrome extension via the
 * native-host (over a local IPC socket). In this skeleton it starts cleanly and
 * registers zero tools — no transport to the extension is wired yet.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "open-browser-control",
  version: "0.0.1",
});

// TODO: connect to the native-host over IPC_SOCKET_PATH, then register browser
// tools (navigate, click, screenshot, read DOM, ...) that forward requests to the
// extension and await responses.

const transport = new StdioServerTransport();
await server.connect(transport);
