import type { Kv } from "./kv.ts";
import { defaultKv } from "./kv.ts";

const KEY = "obc:settings";

export interface Selection {
  provider: string | undefined;
  model: string | undefined;
}

interface SettingsBlob {
  defaultProvider?: string;
  defaultModel?: string;
}

export class SettingsStore {
  constructor(private readonly kv: Kv = defaultKv) {}

  async getSelection(): Promise<Selection> {
    const blob = ((await this.kv.get(KEY)) as SettingsBlob | undefined) ?? {};
    return { provider: blob.defaultProvider, model: blob.defaultModel };
  }

  async setSelection(provider: string, model: string): Promise<void> {
    await this.kv.set(KEY, { defaultProvider: provider, defaultModel: model });
  }
}

export const settingsStore = new SettingsStore();
