/**
 * In-extension control protocol: messages exchanged between the sidepanel (where
 * the pi Agent + its tools run) and the service worker (which holds the browser
 * executors). This is DISTINCT from `@obc/shared` — that is the native-messaging
 * wire contract for the future MCP path; this is internal chrome.runtime messaging.
 */
export const TOOL_NAMES = [
  "navigate",
  "read_page",
  "get_page_text",
  "click",
  "type",
  "scroll",
  "screenshot",
  "wait_for",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolExecRequest {
  type: "OBC_TOOL_EXEC";
  requestId: string;
  tool: ToolName;
  args: Record<string, unknown>;
}

/** Text or image content handed back to the model (mirrors pi's content union). */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolExecOk {
  ok: true;
  content: ToolContent[];
}
export interface ToolExecErr {
  ok: false;
  error: string;
}
export type ToolExecResult = ToolExecOk | ToolExecErr;

const NAME_SET = new Set<string>(TOOL_NAMES);

/** Runtime guard so the SW ignores unrelated chrome.runtime messages. */
export function isToolExecRequest(msg: unknown): msg is ToolExecRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === "OBC_TOOL_EXEC" &&
    typeof m.requestId === "string" &&
    typeof m.tool === "string" &&
    NAME_SET.has(m.tool) &&
    typeof m.args === "object" &&
    m.args !== null
  );
}
