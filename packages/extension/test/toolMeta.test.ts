import { describe, expect, test } from "bun:test";
import { summarizeArgs, TOOL_LABEL } from "../src/sidepanel/components/chat/toolMeta.ts";

describe("summarizeArgs", () => {
  test("navigate shows the url without protocol", () => {
    expect(summarizeArgs("navigate", { url: "https://example.com/path" })).toBe("example.com/path");
  });
  test("navigate shows the direction when there is no url", () => {
    expect(summarizeArgs("navigate", { direction: "back" })).toBe("back");
  });
  test("click shows the ref", () => {
    expect(summarizeArgs("click", { ref: "e3" })).toBe("e3");
  });
  test("type shows ref and a snippet", () => {
    expect(summarizeArgs("type", { ref: "e5", text: "hello world" })).toBe("e5: hello world");
  });
  test("scroll shows the direction", () => {
    expect(summarizeArgs("scroll", { direction: "down" })).toBe("down");
  });
  test("wait_for shows the selector or quoted text", () => {
    expect(summarizeArgs("wait_for", { selector: ".done" })).toBe(".done");
    expect(summarizeArgs("wait_for", { text: "Loaded" })).toBe('"Loaded"');
  });
  test("no-arg tools summarize to empty string", () => {
    expect(summarizeArgs("screenshot", {})).toBe("");
    expect(summarizeArgs("read_page", {})).toBe("");
  });
});

describe("TOOL_LABEL", () => {
  test("maps tool names to human labels", () => {
    expect(TOOL_LABEL.navigate).toBe("Navigate");
    expect(TOOL_LABEL.read_page).toBe("Read page");
  });
});
