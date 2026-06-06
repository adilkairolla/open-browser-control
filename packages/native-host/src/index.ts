#!/usr/bin/env bun
/**
 * Native Messaging host.
 *
 * Chrome launches this process when the extension calls `connectNative()` and
 * exchanges length-prefixed JSON frames over stdio. This skeleton reads and logs
 * incoming frames; it does not yet relay them to the MCP server.
 *
 * IMPORTANT: stdout is the native-messaging channel — never write logs there.
 * All diagnostics go to stderr.
 */
import { FrameDecoder } from "@obc/shared";

function log(...parts: unknown[]): void {
  console.error("[obc-native-host]", ...parts);
}

const decoder = new FrameDecoder();

log("started; waiting for native messages on stdin");

process.stdin.on("data", (chunk: Uint8Array) => {
  for (const message of decoder.push(chunk)) {
    log("recv", message);
    // TODO: relay `message` to the mcp-server over IPC_SOCKET_PATH, and forward
    // the mcp-server's outgoing frames back to Chrome via encodeMessage() on stdout.
  }
});

process.stdin.on("end", () => {
  log("stdin closed; exiting");
  process.exit(0);
});
