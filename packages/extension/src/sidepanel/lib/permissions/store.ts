import { defaultKv, type Kv } from "@/lib/storage/kv";

export type PermissionMode = "ask" | "yolo";

const MODE_KEY = "obc.perm.mode";
const ALLOW_KEY = "obc.perm.allowed";

/** Persists the permission mode and the per-origin "always allow" list. */
export class PermissionStore {
  constructor(private readonly kv: Kv = defaultKv) {}

  async getMode(): Promise<PermissionMode> {
    return (await this.kv.get(MODE_KEY)) === "yolo" ? "yolo" : "ask";
  }
  async setMode(mode: PermissionMode): Promise<void> {
    await this.kv.set(MODE_KEY, mode);
  }
  async isAllowed(origin: string): Promise<boolean> {
    return (await this.list()).includes(origin);
  }
  async allowOrigin(origin: string): Promise<void> {
    const list = await this.list();
    if (!list.includes(origin)) await this.kv.set(ALLOW_KEY, [...list, origin]);
  }
  private async list(): Promise<string[]> {
    const value = await this.kv.get(ALLOW_KEY);
    return Array.isArray(value) ? (value as string[]) : [];
  }
}
