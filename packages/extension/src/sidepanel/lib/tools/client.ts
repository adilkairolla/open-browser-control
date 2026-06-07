import type { ToolExecResult, ToolName } from "../../../control/protocol";

/** Send a tool call to the service worker and await its ToolExecResult. */
export async function execTool(
  tool: ToolName,
  args: Record<string, unknown>,
): Promise<ToolExecResult> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "OBC_TOOL_EXEC",
      requestId: crypto.randomUUID(),
      tool,
      args,
    })) as ToolExecResult | undefined;
    if (!response) return { ok: false, error: "No response from service worker." };
    return response;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
