import { afterEach, describe, expect, test } from "bun:test";
import { EASE_DRAWER, EASE_IN_OUT, EASE_OUT, SPRING, prefersReducedMotion } from "../src/sidepanel/lib/motion.ts";

describe("motion tokens", () => {
  test("easing curves are Emil's cubic-bezier control points", () => {
    expect(EASE_OUT).toEqual([0.23, 1, 0.32, 1]);
    expect(EASE_IN_OUT).toEqual([0.77, 0, 0.175, 1]);
    expect(EASE_DRAWER).toEqual([0.32, 0.72, 0, 1]);
  });

  test("spring is a subtle Apple-style spring", () => {
    expect(SPRING).toEqual({ type: "spring", duration: 0.4, bounce: 0.18 });
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => {
    delete (globalThis as any).matchMedia;
  });

  test("false when matchMedia is unavailable", () => {
    delete (globalThis as any).matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  test("reflects the media query result", () => {
    (globalThis as any).matchMedia = (q: string) => ({ matches: q.includes("reduce") });
    expect(prefersReducedMotion()).toBe(true);
  });
});
