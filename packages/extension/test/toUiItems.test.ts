import { describe, expect, test } from "bun:test";
import { toUiItems } from "../src/sidepanel/components/chat/useSessions.ts";
import type { TranscriptItem } from "../src/sidepanel/lib/transcript.ts";

const T = (role: "user" | "assistant", text: string, id: string): TranscriptItem => ({
  kind: "text",
  id,
  role,
  text,
});

describe("toUiItems", () => {
  test("passes through text items and assigns streaming to the last assistant text", () => {
    const ui = toUiItems([T("user", "hi", "t0"), T("assistant", "yo", "t1")], true);
    expect(ui[0]).toEqual({ kind: "text", id: "t0", role: "user", text: "hi", streaming: false });
    expect(ui[1]).toEqual({ kind: "text", id: "t1", role: "assistant", text: "yo", streaming: true });
  });

  test("does not mark anything streaming when not streaming", () => {
    const ui = toUiItems([T("assistant", "yo", "t0")], false);
    expect((ui[0] as any).streaming).toBe(false);
  });

  test("passes tool items through unchanged", () => {
    const tool: TranscriptItem = {
      kind: "tool",
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
      status: "ok",
      result: { text: "navigated" },
    };
    const ui = toUiItems([tool], false);
    expect(ui[0]).toEqual({
      kind: "tool",
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
      status: "ok",
      result: { text: "navigated" },
      error: undefined,
    });
  });
});
