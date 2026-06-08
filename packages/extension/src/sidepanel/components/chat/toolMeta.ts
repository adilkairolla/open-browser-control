/**
 * Presentation metadata for browser tool calls: human label, per-tool icon, and
 * a one-line args summary. Pure (no React) so summarizeArgs is unit-tested.
 */
import type { IconName } from "./icons";

export const TOOL_LABEL: Record<string, string> = {
  navigate: "Navigate",
  read_page: "Read page",
  get_page_text: "Read text",
  click: "Click",
  type: "Type",
  scroll: "Scroll",
  screenshot: "Screenshot",
  wait_for: "Wait for",
};

export const TOOL_ICON: Record<string, IconName> = {
  navigate: "toolNavigate",
  read_page: "toolRead",
  get_page_text: "toolText",
  click: "toolClick",
  type: "toolType",
  scroll: "toolScroll",
  screenshot: "toolScreenshot",
  wait_for: "toolWait",
};

/** Clip a string to `max` chars with a trailing ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A compact, human one-liner for a tool call's arguments (label shown separately). */
export function summarizeArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "navigate":
      return args.url ? stripProtocol(str(args.url)) : str(args.direction);
    case "click":
      return str(args.ref);
    case "type": {
      const ref = str(args.ref);
      const text = truncate(str(args.text), 40);
      return ref && text ? `${ref}: ${text}` : ref || text;
    }
    case "scroll":
      return str(args.direction);
    case "wait_for":
      return args.selector ? str(args.selector) : args.text ? `"${str(args.text)}"` : "";
    default:
      return "";
  }
}
