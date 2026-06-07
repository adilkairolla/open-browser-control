import { describe, expect, test } from "bun:test";
import { createBrowserTools, MUTATING_TOOLS } from "../src/sidepanel/lib/tools/browserTools.ts";
import type { ToolExecResult } from "../src/control/protocol.ts";

function toolsWith(exec: (tool: string, args: Record<string, unknown>) => Promise<ToolExecResult>) {
  return createBrowserTools(exec);
}

describe("createBrowserTools", () => {
  test("exposes the v1 tool set with names + schemas", () => {
    const names = toolsWith(async () => ({ ok: true, content: [] })).map((t) => t.name).sort();
    expect(names).toEqual(
      ["click", "get_page_text", "navigate", "read_page", "screenshot", "scroll", "type", "wait_for"].sort(),
    );
    for (const t of toolsWith(async () => ({ ok: true, content: [] }))) {
      expect(typeof t.description).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.parameters).toBeDefined();
    }
  });

  test("execute maps an ok result to AgentToolResult content", async () => {
    const tools = toolsWith(async (tool) => {
      expect(tool).toBe("read_page");
      return { ok: true, content: [{ type: "text", text: "tree" }] };
    });
    const readPage = tools.find((t) => t.name === "read_page")!;
    const result = await readPage.execute("id1", { interactiveOnly: true });
    expect(result.content).toEqual([{ type: "text", text: "tree" }]);
  });

  test("execute throws on an error result (pi turns it into an error tool result)", async () => {
    const tools = toolsWith(async () => ({ ok: false, error: "boom" }));
    const navigate = tools.find((t) => t.name === "navigate")!;
    await expect(navigate.execute("id2", { url: "https://x" })).rejects.toThrow("boom");
  });

  test("MUTATING_TOOLS contains exactly navigate, click, type", () => {
    expect([...MUTATING_TOOLS].sort()).toEqual(["click", "navigate", "type"]);
  });
});
