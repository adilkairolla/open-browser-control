import { describe, expect, test } from "bun:test";
import { MemoryKv } from "../src/sidepanel/lib/storage/kv.ts";
import { PermissionStore } from "../src/sidepanel/lib/permissions/store.ts";
import { PermissionController } from "../src/sidepanel/lib/permissions/PermissionController.ts";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";

function ctx(toolName: string): BeforeToolCallContext {
  return { toolCall: { name: toolName } } as unknown as BeforeToolCallContext;
}

/** beforeToolCall awaits async store reads before queueing; flush microtasks so
 *  the pending approval is observable (the real UI sees it via notify()). */
const tick = () => new Promise((r) => setTimeout(r, 0));

function build(opts: { origin?: string } = {}) {
  let n = 0;
  const store = new PermissionStore(new MemoryKv());
  const controller = new PermissionController({
    store,
    mutatingTools: new Set(["navigate", "click", "type"]),
    getActiveOrigin: async () => opts.origin ?? "example.com",
    newId: () => `p${n++}`,
  });
  return { store, controller };
}

describe("PermissionController", () => {
  test("non-mutating tools are always allowed (no prompt)", async () => {
    const { controller } = build();
    expect(await controller.beforeToolCall(ctx("read_page"))).toBeUndefined();
    expect(controller.pending()).toBeUndefined();
  });

  test("yolo mode allows mutating tools without prompting", async () => {
    const { store, controller } = build();
    await store.setMode("yolo");
    expect(await controller.beforeToolCall(ctx("click"))).toBeUndefined();
    expect(controller.pending()).toBeUndefined();
  });

  test("ask mode: deny blocks the call", async () => {
    const { controller } = build();
    const p = controller.beforeToolCall(ctx("click"));
    await tick();
    const pending = controller.pending()!;
    expect(pending.tool).toBe("click");
    controller.resolve(pending.id, "deny");
    expect(await p).toEqual({ block: true, reason: "Denied by user" });
  });

  test("ask mode: allow once permits but does not persist", async () => {
    const { store, controller } = build();
    const p = controller.beforeToolCall(ctx("click"));
    await tick();
    controller.resolve(controller.pending()!.id, "once");
    expect(await p).toBeUndefined();
    expect(await store.isAllowed("example.com")).toBe(false);
  });

  test("ask mode: allow always persists the origin and skips later prompts", async () => {
    const { store, controller } = build();
    const p = controller.beforeToolCall(ctx("navigate"));
    await tick();
    controller.resolve(controller.pending()!.id, "always");
    expect(await p).toBeUndefined();
    expect(await store.isAllowed("example.com")).toBe(true);
    // Second mutating call: no prompt.
    expect(await controller.beforeToolCall(ctx("click"))).toBeUndefined();
    expect(controller.pending()).toBeUndefined();
  });

  test("concurrent prompts queue; resolving the head advances", async () => {
    const { controller } = build();
    const p1 = controller.beforeToolCall(ctx("click"));
    const p2 = controller.beforeToolCall(ctx("type"));
    await tick();
    const first = controller.pending()!;
    expect(first.tool).toBe("click");
    controller.resolve(first.id, "deny");
    expect(await p1).toEqual({ block: true, reason: "Denied by user" });
    const second = controller.pending()!;
    expect(second.tool).toBe("type");
    controller.resolve(second.id, "once");
    expect(await p2).toBeUndefined();
  });

  test("mode round-trips through the store and notifies subscribers", async () => {
    const { controller } = build();
    let calls = 0;
    controller.subscribe(() => calls++);
    await controller.setMode("yolo");
    expect(await controller.getMode()).toBe("yolo");
    expect(calls).toBeGreaterThan(0);
  });
});
