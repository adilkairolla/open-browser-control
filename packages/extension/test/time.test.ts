import { describe, expect, test } from "bun:test";
import { relativeTime } from "../src/sidepanel/lib/time.ts";

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  test("just now for < 1 minute", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("just now");
  });
  test("minutes", () => {
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe("5m ago");
  });
  test("hours", () => {
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
  });
  test("days", () => {
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe("2d ago");
  });
  test("weeks", () => {
    expect(relativeTime(NOW - 14 * DAY, NOW)).toBe("2w ago");
  });
});
