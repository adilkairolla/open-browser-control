import { cdpSend } from "./cdp.ts";
import {
  buildAccessibilityTree,
  extractPageText,
  focusRef,
  getRefRect,
  waitForInPage,
} from "./inject/page-fns.ts";
import type { ToolContent, ToolExecResult, ToolName } from "./protocol.ts";

type Args = Record<string, unknown>;
type Executor = (args: Args, tabId: number) => Promise<ToolExecResult>;

const ok = (text: string): ToolExecResult => ({ ok: true, content: [{ type: "text", text }] });
const okContent = (content: ToolContent[]): ToolExecResult => ({ ok: true, content });
const err = (error: string): ToolExecResult => ({ ok: false, error });

/** Run one self-contained function in the page and return its value. */
async function inPage<R, A extends unknown[]>(
  tabId: number,
  func: (...a: A) => R,
  args: A,
): Promise<R> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result as R;
}

const navigate: Executor = async (args, tabId) => {
  const direction = args.direction;
  if (direction === "back") {
    await chrome.tabs.goBack(tabId);
    return ok("Navigated back.");
  }
  if (direction === "forward") {
    await chrome.tabs.goForward(tabId);
    return ok("Navigated forward.");
  }
  const url = args.url;
  if (typeof url !== "string" || !url) return err("navigate requires a `url` or `direction`.");
  await chrome.tabs.update(tabId, { url });
  return ok(`Navigated to ${url}.`);
};

const readPage: Executor = async (args, tabId) => {
  const interactiveOnly = args.interactiveOnly !== false; // default true
  const tree = await inPage(tabId, buildAccessibilityTree, [interactiveOnly]);
  return ok(tree);
};

const getPageText: Executor = async (_args, tabId) => {
  const text = await inPage(tabId, extractPageText, []);
  return ok(text || "(empty page)");
};

const click: Executor = async (args, tabId) => {
  const ref = args.ref;
  if (typeof ref !== "string") return err("click requires a `ref` from read_page.");
  const rect = await inPage(tabId, getRefRect, [ref]);
  if (!rect?.found) return err(`No element for ref "${ref}". Call read_page again.`);
  const base = { x: rect.x, y: rect.y, button: "left" as const, clickCount: 1 };
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  return ok(`Clicked ${ref}.`);
};

const type: Executor = async (args, tabId) => {
  const ref = args.ref;
  const text = args.text;
  if (typeof ref !== "string") return err("type requires a `ref`.");
  if (typeof text !== "string") return err("type requires `text`.");
  const focused = await inPage(tabId, focusRef, [ref]);
  if (!focused?.found) return err(`No element for ref "${ref}". Call read_page again.`);
  await cdpSend(tabId, "Input.insertText", { text });
  return ok(`Typed into ${ref}.`);
};

const scroll: Executor = async (args, tabId) => {
  const direction = args.direction === "up" ? "up" : "down";
  const amount = typeof args.amount === "number" ? args.amount : 600;
  const size = await inPage(tabId, () => ({ w: window.innerWidth, h: window.innerHeight }), []);
  const x = Math.floor((size?.w ?? 800) / 2);
  const y = Math.floor((size?.h ?? 600) / 2);
  await cdpSend(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY: direction === "up" ? -amount : amount,
  });
  return ok(`Scrolled ${direction}.`);
};

const screenshot: Executor = async (_args, tabId) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId == null) return err("Cannot screenshot: no window for tab.");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const data = dataUrl.replace(/^data:image\/png;base64,/, "");
  return okContent([{ type: "image", data, mimeType: "image/png" }]);
};

const waitFor: Executor = async (args, tabId) => {
  const selector = typeof args.selector === "string" ? args.selector : undefined;
  const text = typeof args.text === "string" ? args.text : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 5000;
  if (!selector && !text) return err("wait_for requires `selector` or `text`.");
  const result = await inPage(tabId, waitForInPage, [{ selector, text, timeoutMs }]);
  return result?.found
    ? ok("Condition met.")
    : err(`Timed out after ${timeoutMs}ms waiting for ${selector ?? text}.`);
};

const EXECUTORS: Record<ToolName, Executor> = {
  navigate,
  read_page: readPage,
  get_page_text: getPageText,
  click,
  type,
  scroll,
  screenshot,
  wait_for: waitFor,
};

/** Route a tool call to its executor, normalizing thrown errors into ToolExecErr. */
export async function dispatch(tool: ToolName, args: Args, tabId: number): Promise<ToolExecResult> {
  const executor = EXECUTORS[tool];
  if (!executor) return { ok: false, error: `Unknown tool "${tool}".` };
  try {
    return await executor(args, tabId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
