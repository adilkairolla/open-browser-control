import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolExecResult, ToolName } from "../../../control/protocol";
import { execTool as defaultExec } from "./client";

/** Tools that change page/world state and are gated in `ask` mode. */
export const MUTATING_TOOLS = new Set<ToolName>(["navigate", "click", "type"]);

type Exec = (tool: ToolName, args: Record<string, unknown>) => Promise<ToolExecResult>;

interface Spec {
  name: ToolName;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
}

const SPECS: Spec[] = [
  {
    name: "navigate",
    label: "Navigate",
    description: "Navigate the active tab to a URL, or go back/forward in history.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Absolute URL to open." })),
      direction: Type.Optional(
        Type.Union([Type.Literal("back"), Type.Literal("forward")], {
          description: "Go back or forward instead of opening a URL.",
        }),
      ),
    }),
  },
  {
    name: "read_page",
    label: "Read page",
    description:
      'Return a compact accessibility tree of the active page. Each line is `[ref] role "name"`; use a ref with click/type.',
    parameters: Type.Object({
      interactiveOnly: Type.Optional(
        Type.Boolean({ description: "Only interactive elements (default true)." }),
      ),
    }),
  },
  {
    name: "get_page_text",
    label: "Read text",
    description: "Return the readable text content of the active page.",
    parameters: Type.Object({}),
  },
  {
    name: "click",
    label: "Click",
    description: "Click an element by its ref from read_page.",
    parameters: Type.Object({ ref: Type.String({ description: "Element ref, e.g. e3." }) }),
  },
  {
    name: "type",
    label: "Type",
    description: "Focus an element by ref and type text into it.",
    parameters: Type.Object({
      ref: Type.String({ description: "Element ref to type into." }),
      text: Type.String({ description: "Text to insert." }),
    }),
  },
  {
    name: "scroll",
    label: "Scroll",
    description: "Scroll the page up or down.",
    parameters: Type.Object({
      direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
      amount: Type.Optional(Type.Number({ description: "Pixels (default 600)." })),
    }),
  },
  {
    name: "screenshot",
    label: "Screenshot",
    description: "Capture a PNG screenshot of the visible viewport.",
    parameters: Type.Object({}),
  },
  {
    name: "wait_for",
    label: "Wait for",
    description: "Wait until a CSS selector matches or text appears (or timeout).",
    parameters: Type.Object({
      selector: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number({ description: "Default 5000." })),
    }),
  },
];

/** Build the pi AgentTools. `exec` is injected for tests; defaults to the SW client. */
export function createBrowserTools(exec: Exec = defaultExec): AgentTool<any>[] {
  return SPECS.map((spec) => ({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId: string, args: unknown) => {
      const result = await exec(spec.name, (args as Record<string, unknown>) ?? {});
      if (!result.ok) throw new Error(result.error); // pi → error tool result
      return { content: result.content, details: null };
    },
  }));
}
