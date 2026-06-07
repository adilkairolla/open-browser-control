import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/storage/kv.ts";

describe("MemoryKv", () => {
  test("get returns undefined for missing key", async () => {
    const kv = new MemoryKv();
    expect(await kv.get("missing")).toBeUndefined();
  });

  test("set then get round-trips a value", async () => {
    const kv = new MemoryKv();
    await kv.set("k", { a: 1 });
    expect(await kv.get("k")).toEqual({ a: 1 });
  });

  test("remove deletes a key", async () => {
    const kv = new MemoryKv();
    await kv.set("k", 1);
    await kv.remove("k");
    expect(await kv.get("k")).toBeUndefined();
  });
});
