import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  buildAccessibilityTree,
  extractPageText,
  focusRef,
  getRefRect,
  waitForInPage,
} from "../src/control/inject/page-fns.ts";

let win: Window;
function setBody(html: string) {
  (globalThis as any).document.body.innerHTML = html;
}
beforeEach(() => {
  win = new Window({ url: "https://example.com" });
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).getComputedStyle = win.getComputedStyle.bind(win);
});
afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).getComputedStyle;
});

describe("buildAccessibilityTree", () => {
  test("stamps refs on interactive elements and emits role + name", () => {
    setBody(`<button>Sign in</button><a href="/x">Docs</a><p>ignored</p>`);
    const tree = buildAccessibilityTree(true);
    expect(tree).toContain('[e1] button "Sign in"');
    expect(tree).toContain('[e2] a "Docs"');
    expect(tree).not.toContain("ignored");
    expect((globalThis as any).document.querySelector("button")!.getAttribute("data-obc-ref")).toBe("e1");
  });

  test("re-running clears stale refs", () => {
    setBody(`<button>One</button>`);
    buildAccessibilityTree(true);
    setBody(`<button>Two</button>`);
    buildAccessibilityTree(true);
    const refs = [...(globalThis as any).document.querySelectorAll("[data-obc-ref]")];
    expect(refs).toHaveLength(1);
    expect(refs[0]!.getAttribute("data-obc-ref")).toBe("e1");
  });

  test("non-interactive mode also includes headings", () => {
    setBody(`<h1>Title</h1><button>Go</button>`);
    const tree = buildAccessibilityTree(false);
    expect(tree).toContain("Title");
    expect(tree).toContain("Go");
  });

  test("returns a sentinel when nothing matches", () => {
    setBody(`<p>just text</p>`);
    expect(buildAccessibilityTree(true)).toBe("(no interactive elements found)");
  });
});

describe("getRefRect / focusRef", () => {
  test("getRefRect reports found=false for an unknown ref", () => {
    setBody(`<button>Hi</button>`);
    expect(getRefRect("e99").found).toBe(false);
  });
  test("focusRef focuses a known ref", () => {
    setBody(`<input />`);
    buildAccessibilityTree(true);
    expect(focusRef("e1").found).toBe(true);
  });
});

describe("extractPageText", () => {
  test("strips scripts/styles and collapses whitespace", () => {
    setBody(`<script>var x=1</script><style>.a{}</style><article>Hello   world</article>`);
    const text = extractPageText();
    expect(text).toContain("Hello world");
    expect(text).not.toContain("var x");
  });
});

describe("waitForInPage", () => {
  test("resolves found=true immediately when the selector is present", async () => {
    setBody(`<div id="ready">ok</div>`);
    expect(await waitForInPage({ selector: "#ready", timeoutMs: 500 })).toEqual({ found: true });
  });
  test("resolves found=false after timeout when absent", async () => {
    setBody(`<div></div>`);
    expect(await waitForInPage({ selector: "#nope", timeoutMs: 120 })).toEqual({ found: false });
  });
});
