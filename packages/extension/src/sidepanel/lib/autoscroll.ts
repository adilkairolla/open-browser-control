/**
 * Pure stick-to-bottom logic for the virtualized chat list. Kept free of DOM
 * and React so the bottom-tracking decision can be unit-tested (this repo tests
 * logic, not React rendering).
 */

/** How close (px) to the bottom still counts as "pinned to the bottom". */
export const STICK_THRESHOLD = 64;

/**
 * True when the scroll position is within `threshold` px of the bottom — i.e.
 * the user is effectively at the latest message, so the list should keep
 * auto-scrolling as new content streams in. Content shorter than the viewport
 * (nothing to scroll) counts as near the bottom.
 */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = STICK_THRESHOLD,
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold;
}
