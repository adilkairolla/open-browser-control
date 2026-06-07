import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/kv.ts";
import { SettingsStore } from "../src/sidepanel/lib/settingsStore.ts";

describe("SettingsStore", () => {
  test("returns empty selection by default", async () => {
    const store = new SettingsStore(new MemoryKv());
    expect(await store.getSelection()).toEqual({ provider: undefined, model: undefined });
  });

  test("persists provider and model selection", async () => {
    const kv = new MemoryKv();
    const store = new SettingsStore(kv);
    await store.setSelection("openrouter", "anthropic/claude-3.5-haiku");
    expect(await store.getSelection()).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });
    const store2 = new SettingsStore(kv);
    expect((await store2.getSelection()).provider).toBe("openrouter");
  });
});
