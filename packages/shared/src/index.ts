export * from "./protocol.ts";
export * from "./framing.ts";

/** The Native Messaging host name Chrome uses to look up the host manifest. */
export const NATIVE_HOST_NAME = "com.open_browser_control.host";

/**
 * Well-known unix socket where the native-host and mcp-server rendezvous.
 * (The relay itself is not wired in the skeleton — see the design doc.)
 */
export const IPC_SOCKET_PATH = "/tmp/open-browser-control.sock";
