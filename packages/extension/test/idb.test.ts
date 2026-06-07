import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { Database, type DatabaseSpec } from "../src/sidepanel/lib/storage/idb.ts";

interface Row {
  id: string;
  group: string;
  n: number;
}

const SPEC: DatabaseSpec = {
  name: "test-db",
  version: 1,
  stores: [{ name: "rows", keyPath: "id", indexes: [{ name: "group", keyPath: "group" }] }],
};

function freshCollection() {
  const db = new Database(SPEC, new IDBFactory());
  return db.collection<Row>("rows");
}

describe("idb Collection", () => {
  test("get returns undefined for a missing id", async () => {
    const c = freshCollection();
    expect(await c.get("nope")).toBeUndefined();
  });

  test("put then get round-trips a record", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    expect(await c.get("a")).toEqual({ id: "a", group: "g1", n: 1 });
  });

  test("put upserts an existing id", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "a", group: "g1", n: 2 });
    expect((await c.get("a"))?.n).toBe(2);
    expect(await c.count()).toBe(1);
  });

  test("getAll returns every record", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g2", n: 2 });
    const all = await c.getAll();
    expect(all.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("getAllByIndex filters by an index value", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g1", n: 2 });
    await c.put({ id: "c", group: "g2", n: 3 });
    const g1 = await c.getAllByIndex("group", "g1");
    expect(g1.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("deleteByIndex removes all matching records", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g1", n: 2 });
    await c.put({ id: "c", group: "g2", n: 3 });
    await c.deleteByIndex("group", "g1");
    expect(await c.count()).toBe(1);
    expect((await c.getAll())[0]?.id).toBe("c");
  });

  test("delete removes a single record and clear empties the store", async () => {
    const c = freshCollection();
    await c.put({ id: "a", group: "g1", n: 1 });
    await c.put({ id: "b", group: "g1", n: 2 });
    await c.delete("a");
    expect(await c.get("a")).toBeUndefined();
    await c.clear();
    expect(await c.count()).toBe(0);
  });
});
