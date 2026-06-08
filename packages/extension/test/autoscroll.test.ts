import { describe, expect, test } from "bun:test";
import { isNearBottom, STICK_THRESHOLD } from "../src/sidepanel/lib/autoscroll.ts";

describe("isNearBottom", () => {
  test("exactly at the bottom is near", () => {
    // scrollHeight 1000, viewport 400, scrolled to the end (600)
    expect(isNearBottom(600, 400, 1000)).toBe(true);
  });

  test("within the threshold is near", () => {
    // 30px from the bottom (< 64)
    expect(isNearBottom(570, 400, 1000)).toBe(true);
  });

  test("exactly at the threshold is near", () => {
    // 64px from the bottom
    expect(isNearBottom(536, 400, 1000)).toBe(true);
  });

  test("beyond the threshold is not near", () => {
    // 100px from the bottom (> 64)
    expect(isNearBottom(500, 400, 1000)).toBe(false);
  });

  test("content shorter than the viewport is near", () => {
    // nothing to scroll → distance is negative → near
    expect(isNearBottom(0, 400, 200)).toBe(true);
  });

  test("respects a custom threshold", () => {
    // 100px from the bottom, threshold 120
    expect(isNearBottom(500, 400, 1000, 120)).toBe(true);
  });

  test("exposes a default threshold constant", () => {
    expect(STICK_THRESHOLD).toBe(64);
  });
});
