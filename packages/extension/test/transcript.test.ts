import { describe, expect, test } from "bun:test";
import { buildTranscript } from "../src/sidepanel/lib/transcript.ts";

// Minimal stand-ins for pi AgentMessage shapes (only the fields buildTranscript reads).
const userMsg = (text: string) => ({ role: "user", content: text });
const asstText = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const asstTool = (id: string, name: string, args: Record<string, unknown>) => ({
  role: "assistant",
  content: [{ type: "toolCall", id, name, arguments: args }],
});
const toolResult = (toolCallId: string, text: string, isError = false) => ({
  role: "toolResult",
  toolCallId,
  toolName: "x",
  content: [{ type: "text", text }],
  isError,
});
const toolResultImage = (toolCallId: string, data: string) => ({
  role: "toolResult",
  toolCallId,
  toolName: "screenshot",
  content: [{ type: "image", data, mimeType: "image/png" }],
  isError: false,
});

describe("buildTranscript", () => {
  test("interleaves user text, assistant text, and tool calls in order", () => {
    const items = buildTranscript([
      userMsg("go to example"),
      asstTool("c1", "navigate", { url: "https://example.com" }),
      toolResult("c1", "navigated"),
      asstText("Done."),
    ] as any);
    expect(items.map((i) => i.kind)).toEqual(["text", "tool", "text"]);
    expect(items[0]).toMatchObject({ kind: "text", role: "user", text: "go to example" });
    expect(items[1]).toMatchObject({
      kind: "tool",
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
      status: "ok",
      result: { text: "navigated" },
    });
    expect(items[2]).toMatchObject({ kind: "text", role: "assistant", text: "Done." });
  });

  test("a tool call with no matching result is running", () => {
    const items = buildTranscript([asstTool("c1", "click", { ref: "e3" })] as any);
    expect(items[0]).toMatchObject({ kind: "tool", status: "running" });
    expect((items[0] as any).result).toBeUndefined();
  });

  test("an errored tool result is marked error with its text", () => {
    const items = buildTranscript([
      asstTool("c1", "click", { ref: "e9" }),
      toolResult("c1", "no such element", true),
    ] as any);
    expect(items[0]).toMatchObject({ kind: "tool", status: "error", error: "no such element" });
  });

  test("extracts an image result", () => {
    const items = buildTranscript([
      asstTool("c1", "screenshot", {}),
      toolResultImage("c1", "BASE64DATA"),
    ] as any);
    expect((items[0] as any).result.image).toEqual({ data: "BASE64DATA", mimeType: "image/png" });
  });

  test("appends the streaming message and skips empty text blocks", () => {
    const items = buildTranscript([userMsg("hi")] as any, asstText("partial") as any);
    expect(items.map((i) => i.kind)).toEqual(["text", "text"]);
    expect(items[1]).toMatchObject({ role: "assistant", text: "partial" });
  });

  test("assigns unique ids (text counter + toolCallId)", () => {
    const items = buildTranscript([userMsg("a"), asstTool("c1", "navigate", {}), asstText("b")] as any);
    expect(items.map((i) => i.id)).toEqual(["t0", "c1", "t1"]);
  });
});
