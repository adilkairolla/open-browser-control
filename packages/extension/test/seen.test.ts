import { describe, expect, test } from "bun:test";
import { SeenSet } from "../src/sidepanel/lib/seen.ts";

describe("SeenSet", () => {
  test("ids seeded at construction are not new", () => {
    const seen = new SeenSet(["a", "b"]);
    expect(seen.isNew("a")).toBe(false);
    expect(seen.isNew("b")).toBe(false);
  });

  test("an unseen id is new", () => {
    const seen = new SeenSet(["a"]);
    expect(seen.isNew("c")).toBe(true);
  });

  test("isNew is a pure query — it does not record", () => {
    const seen = new SeenSet();
    expect(seen.isNew("x")).toBe(true);
    expect(seen.isNew("x")).toBe(true);
  });

  test("remember makes ids no longer new", () => {
    const seen = new SeenSet();
    expect(seen.isNew("x")).toBe(true);
    seen.remember(["x", "y"]);
    expect(seen.isNew("x")).toBe(false);
    expect(seen.isNew("y")).toBe(false);
  });
});
