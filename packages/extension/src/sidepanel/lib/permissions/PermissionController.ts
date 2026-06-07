import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { PermissionMode, PermissionStore } from "./store";

export type ApprovalDecision = "once" | "always" | "deny";

export interface PendingApproval {
  id: string;
  tool: string;
  origin?: string;
}

export interface PermissionControllerDeps {
  store: PermissionStore;
  mutatingTools: Set<string>;
  getActiveOrigin: () => Promise<string | undefined>;
  newId?: () => string;
}

/**
 * pi `beforeToolCall` guard. Reads are always allowed; in `yolo` everything is
 * allowed; in `ask`, mutating tools need the active origin to be remembered or a
 * fresh user decision. Surfaces approvals via a queue the UI renders + resolves.
 */
export class PermissionController {
  private readonly store: PermissionStore;
  private readonly mutating: Set<string>;
  private readonly getActiveOrigin: () => Promise<string | undefined>;
  private readonly newId: () => string;
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Map<string, (d: ApprovalDecision) => void>();
  private queue: PendingApproval[] = [];

  constructor(deps: PermissionControllerDeps) {
    this.store = deps.store;
    this.mutating = deps.mutatingTools;
    this.getActiveOrigin = deps.getActiveOrigin;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** The approval currently shown to the user (head of the queue). */
  pending(): PendingApproval | undefined {
    return this.queue[0];
  }

  getMode(): Promise<PermissionMode> {
    return this.store.getMode();
  }
  async setMode(mode: PermissionMode): Promise<void> {
    await this.store.setMode(mode);
    this.notify();
  }

  /** Bound so it can be passed directly as the Agent's beforeToolCall. */
  beforeToolCall = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const tool = ctx.toolCall.name;
    if (!this.mutating.has(tool)) return undefined;
    if ((await this.store.getMode()) === "yolo") return undefined;
    const origin = await this.getActiveOrigin();
    if (origin && (await this.store.isAllowed(origin))) return undefined;

    const decision = await this.request(tool, origin);
    if (decision === "deny") return { block: true, reason: "Denied by user" };
    if (decision === "always" && origin) await this.store.allowOrigin(origin);
    return undefined;
  };

  private request(tool: string, origin?: string): Promise<ApprovalDecision> {
    const id = this.newId();
    return new Promise<ApprovalDecision>((resolve) => {
      this.waiters.set(id, resolve);
      this.queue.push({ id, tool, origin });
      this.notify();
    });
  }

  /** Called by the UI with the user's choice for a queued approval. */
  resolve(id: string, decision: ApprovalDecision): void {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    this.waiters.delete(id);
    this.queue = this.queue.filter((p) => p.id !== id);
    waiter(decision);
    this.notify();
  }
}
