/** Minimal async key-value interface, backed by chrome.storage.local in prod. */
export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** In-memory implementation for tests. */
export class MemoryKv implements Kv {
  private readonly map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** chrome.storage.local-backed implementation for the extension runtime. */
export class ChromeKv implements Kv {
  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}

/** Default store used by the app (overridable in tests). */
export const defaultKv: Kv = new ChromeKv();
