import { describe, expect, test } from "bun:test";
import { isToolExecRequest, TOOL_NAMES } from "../src/control/protocol.ts";

describe("control protocol", () => {
  test("isToolExecRequest accepts a well-formed request", () => {
    expect(isToolExecRequest({ type: "OBC_TOOL_EXEC", requestId: "r1", tool: "navigate", args: {} })).toBe(true);
  });
  test("isToolExecRequest rejects foreign messages", () => {
    expect(isToolExecRequest({ type: "SOMETHING_ELSE" })).toBe(false);
    expect(isToolExecRequest(null)).toBe(false);
    expect(isToolExecRequest({ type: "OBC_TOOL_EXEC", tool: "navigate" })).toBe(false);
  });
  test("TOOL_NAMES lists the v1 tool set", () => {
    expect(TOOL_NAMES).toEqual([
      "navigate", "read_page", "get_page_text", "click", "type", "scroll", "screenshot", "wait_for",
    ]);
  });
});
