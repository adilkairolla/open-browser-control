import { describe, expect, test } from "bun:test";
import { getModels } from "@earendil-works/pi-ai";
import { ChatSession } from "../src/sidepanel/lib/chat.ts";

const model = getModels("openrouter")[0]!;

describe("ChatSession", () => {
  test("constructs with a model and exposes an empty view", () => {
    const session = new ChatSession({
      model,
      getToken: async () => "sk-or-test",
    });
    expect(session.getMessages()).toEqual([]);
    expect(session.isStreaming()).toBe(false);
  });

  test("setModel swaps the active model", () => {
    const session = new ChatSession({ model, getToken: async () => "k" });
    const other = getModels("groq")[0]!;
    session.setModel(other);
    expect(session.currentModel().id).toBe(other.id);
  });

  // Live end-to-end test — skipped unless OPENROUTER_API_KEY is set.
  // Run with: OPENROUTER_API_KEY=sk-or-... bun test test/chat.test.ts
  test.skipIf(!process.env.OPENROUTER_API_KEY)(
    "streams a real reply from OpenRouter",
    async () => {
      const liveModel =
        getModels("openrouter").find((m) => m.id === "openai/gpt-4o-mini") ?? getModels("openrouter")[0]!;
      const session = new ChatSession({
        model: liveModel,
        getToken: async () => process.env.OPENROUTER_API_KEY!,
        systemPrompt: "Reply with exactly the word: pong",
      });
      await session.send("ping");
      const msgs = session.getMessages();
      const assistant = msgs.findLast((m) => m.role === "assistant");
      expect(assistant?.text.toLowerCase()).toContain("pong");
    },
    30_000,
  );
});
