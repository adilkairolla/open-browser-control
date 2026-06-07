import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openSessionsDb } from "../src/sidepanel/lib/sessions/db.ts";

describe("openSessionsDb", () => {
  test("round-trips a conversation and queries messages by conversationId", async () => {
    const { conversations, messages } = openSessionsDb(new IDBFactory());

    await conversations.put({
      id: "c1",
      title: "First chat",
      origin: "example.com",
      provider: "openrouter",
      model: "anthropic/claude-opus-4.8",
      createdAt: 1,
      updatedAt: 2,
    });
    await messages.put({ id: "m1", conversationId: "c1", role: "user", text: "hi", seq: 0, createdAt: 1 });
    await messages.put({ id: "m2", conversationId: "c1", role: "assistant", text: "yo", seq: 1, createdAt: 2 });
    await messages.put({ id: "m3", conversationId: "c2", role: "user", text: "other", seq: 0, createdAt: 3 });

    expect((await conversations.get("c1"))?.title).toBe("First chat");
    const forC1 = await messages.getAllByIndex("conversationId", "c1");
    expect(forC1.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });
});
