/**
 * Shared motion configuration for the `motion`-driven components (the
 * conversations drawer and the tool-approval card). Everything else animates in
 * CSS via the tokens/utilities in `index.css`; this file only exists for the
 * places where React unmount-exit animations need JS.
 *
 * Curves come from Emil Kowalski's design-engineering guidance: the built-in CSS
 * easings are too weak, so we use stronger custom variants. `motion` accepts a
 * 4-number array as a cubic-bezier `ease`.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const; // enter/exit workhorse
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const; // on-screen movement
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const; // iOS-like drawer

/** Subtle Apple-style spring for the few "delight" moments. */
export const SPRING = { type: "spring", duration: 0.4, bounce: 0.18 } as const;

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
