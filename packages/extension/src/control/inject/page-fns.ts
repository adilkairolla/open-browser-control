/**
 * Functions injected into the page via chrome.scripting.executeScript({ func }).
 * CRITICAL: each function must be fully self-contained — no imports, no
 * module-scope references — because Chrome serializes them with `.toString()`.
 * They use the page globals `document`, `getComputedStyle`, `Date`, `setTimeout`.
 */

/**
 * Walk the DOM, stamp `data-obc-ref` on interactive (and, unless interactiveOnly,
 * heading) elements, and return a compact one-line-per-element listing the model
 * can act on. Clears refs from a previous run so refs always reflect this read.
 */
export function buildAccessibilityTree(interactiveOnly: boolean): string {
  const INTERACTIVE =
    'a[href],button,input,select,textarea,[role],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]';

  const doc = document;
  doc.querySelectorAll("[data-obc-ref]").forEach((el) => el.removeAttribute("data-obc-ref"));

  const accName = (el: Element): string => {
    const input = el as HTMLInputElement;
    const raw =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("alt") ||
      (typeof input.value === "string" ? input.value : "") ||
      (el.textContent || "") ||
      el.getAttribute("title") ||
      "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 80);
  };
  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el as HTMLElement);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const roleOf = (el: Element): string => el.getAttribute("role") || el.tagName.toLowerCase();

  const selector = interactiveOnly ? INTERACTIVE : INTERACTIVE + ",h1,h2,h3,h4,h5,h6";
  const lines: string[] = [];
  let counter = 0;
  for (const el of Array.from(doc.querySelectorAll(selector))) {
    if (!isVisible(el)) continue;
    const ref = "e" + ++counter;
    el.setAttribute("data-obc-ref", ref);
    const label = accName(el);
    lines.push(`[${ref}] ${roleOf(el)}${label ? ` "${label}"` : ""}`);
  }
  return lines.length ? lines.join("\n") : "(no interactive elements found)";
}

/** Resolve a ref to its viewport-center coordinates (CSS px), scrolling into view. */
export function getRefRect(ref: string): { found: boolean; x: number; y: number } {
  const el = document.querySelector(`[data-obc-ref="${ref}"]`) as HTMLElement | null;
  if (!el) return { found: false, x: 0, y: 0 };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Focus a ref so a subsequent CDP Input.insertText lands in it. */
export function focusRef(ref: string): { found: boolean } {
  const el = document.querySelector(`[data-obc-ref="${ref}"]`) as HTMLElement | null;
  if (!el) return { found: false };
  el.focus();
  return { found: true };
}

/** Best-effort readable text extraction. */
export function extractPageText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,style,noscript,svg").forEach((el) => el.remove());
  return (clone.textContent || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20000);
}

/** Poll until a selector matches or text appears, or the timeout elapses. */
export async function waitForInPage(opts: {
  selector?: string;
  text?: string;
  timeoutMs: number;
}): Promise<{ found: boolean }> {
  const deadline = Date.now() + opts.timeoutMs;
  const check = (): boolean => {
    if (opts.selector && document.querySelector(opts.selector)) return true;
    if (opts.text && (document.body.textContent || "").includes(opts.text)) return true;
    return false;
  };
  while (Date.now() < deadline) {
    if (check()) return { found: true };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { found: check() };
}
