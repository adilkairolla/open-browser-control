import type { Kv } from "./storage/kv.ts";
import { defaultKv } from "./storage/kv.ts";

const KEY = "obc:auth";

export interface ApiKeyCredential {
  type: "api_key";
  key: string;
}

export interface OAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  /** epoch ms; treated as expired when Date.now() >= expires */
  expires: number;
}

export type Credential = ApiKeyCredential | OAuthCredential;

type AuthBlob = Record<string, Credential>;

/** Refreshes an OAuth credential given its refresh token. Injected for testing. */
export type Refresher = (refresh: string) => Promise<OAuthCredential>;

export class AuthStore {
  private refresher?: Refresher;

  constructor(private readonly kv: Kv = defaultKv) {}

  setRefresher(refresher: Refresher): void {
    this.refresher = refresher;
  }

  private async readAll(): Promise<AuthBlob> {
    return ((await this.kv.get(KEY)) as AuthBlob | undefined) ?? {};
  }

  private async writeAll(blob: AuthBlob): Promise<void> {
    await this.kv.set(KEY, blob);
  }

  async listProviders(): Promise<string[]> {
    return Object.keys(await this.readAll());
  }

  async get(provider: string): Promise<Credential | undefined> {
    return (await this.readAll())[provider];
  }

  async setApiKey(provider: string, key: string): Promise<void> {
    const blob = await this.readAll();
    blob[provider] = { type: "api_key", key };
    await this.writeAll(blob);
  }

  async setOAuth(provider: string, cred: OAuthCredential): Promise<void> {
    const blob = await this.readAll();
    blob[provider] = cred;
    await this.writeAll(blob);
  }

  async remove(provider: string): Promise<void> {
    const blob = await this.readAll();
    delete blob[provider];
    await this.writeAll(blob);
  }

  /**
   * Resolve a usable token for the provider. For OAuth, refreshes (and persists)
   * when expired. The returned string is passed to pi as `apiKey`; Anthropic
   * OAuth access tokens contain "sk-ant-oat" so pi auto-uses Bearer auth.
   */
  async getToken(provider: string): Promise<string | undefined> {
    const cred = await this.get(provider);
    if (!cred) return undefined;
    if (cred.type === "api_key") return cred.key;
    if (Date.now() < cred.expires) return cred.access;
    if (!this.refresher) return cred.access; // best effort; let the call 401
    const refreshed = await this.refresher(cred.refresh);
    await this.setOAuth(provider, refreshed);
    return refreshed.access;
  }
}

/** App-wide singleton used by the UI. */
export const authStore = new AuthStore();
