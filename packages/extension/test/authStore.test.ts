import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/storage/kv.ts";
import { AuthStore } from "../src/sidepanel/lib/authStore.ts";
import type { OAuthCredential } from "../src/sidepanel/lib/authStore.ts";

describe("AuthStore", () => {
  test("stores and lists api-key credentials", async () => {
    const store = new AuthStore(new MemoryKv());
    await store.setApiKey("openrouter", "sk-or-123");
    expect(await store.listProviders()).toEqual(["openrouter"]);
    expect(await store.get("openrouter")).toEqual({ type: "api_key", key: "sk-or-123" });
  });

  test("remove deletes a provider", async () => {
    const store = new AuthStore(new MemoryKv());
    await store.setApiKey("groq", "gsk_1");
    await store.remove("groq");
    expect(await store.listProviders()).toEqual([]);
  });

  test("getToken returns the api key for api-key creds", async () => {
    const store = new AuthStore(new MemoryKv());
    await store.setApiKey("openrouter", "sk-or-123");
    expect(await store.getToken("openrouter")).toBe("sk-or-123");
  });

  test("getToken returns the access token when oauth is unexpired", async () => {
    const store = new AuthStore(new MemoryKv());
    const cred: OAuthCredential = {
      type: "oauth",
      access: "sk-ant-oat-fresh",
      refresh: "r1",
      expires: Date.now() + 60_000,
    };
    await store.setOAuth("anthropic", cred);
    expect(await store.getToken("anthropic")).toBe("sk-ant-oat-fresh");
  });

  test("getToken refreshes and persists when oauth is expired", async () => {
    const kv = new MemoryKv();
    const store = new AuthStore(kv);
    await store.setOAuth("anthropic", {
      type: "oauth",
      access: "old",
      refresh: "r1",
      expires: Date.now() - 1,
    });
    let refreshCalledWith = "";
    store.setRefresher(async (refresh) => {
      refreshCalledWith = refresh;
      return { type: "oauth", access: "sk-ant-oat-new", refresh: "r2", expires: Date.now() + 60_000 };
    });
    expect(await store.getToken("anthropic")).toBe("sk-ant-oat-new");
    expect(refreshCalledWith).toBe("r1");
    expect(await store.get("anthropic")).toMatchObject({ access: "sk-ant-oat-new", refresh: "r2" });
  });

  test("getToken returns undefined for unknown provider", async () => {
    const store = new AuthStore(new MemoryKv());
    expect(await store.getToken("openai")).toBeUndefined();
  });
});
