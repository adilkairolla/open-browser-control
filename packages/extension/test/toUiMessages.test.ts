import { describe, expect, test } from "bun:test";
import { toUiMessages } from "../src/sidepanel/components/chat/useSessions.ts";

describe("toUiMessages", () => {
  test("maps role/text and assigns positional ids", () => {
    const ui = toUiMessages([{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }], false);
    expect(ui).toEqual([
      { id: "0", role: "user", text: "hi", streaming: false },
      { id: "1", role: "assistant", text: "yo", streaming: false },
    ]);
  });

  test("marks only the last assistant message as streaming", () => {
    const ui = toUiMessages(
      [{ role: "user", text: "hi" }, { role: "assistant", text: "partial" }],
      true,
    );
    expect(ui[1]!.streaming).toBe(true);
    expect(ui[0]!.streaming).toBe(false);
  });

  test("does not mark a trailing user message as streaming", () => {
    const ui = toUiMessages([{ role: "assistant", text: "yo" }, { role: "user", text: "hi" }], true);
    expect(ui[1]!.streaming).toBe(false);
  });
});
