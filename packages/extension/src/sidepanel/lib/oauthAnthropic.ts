import type { OAuthCredential } from "./authStore.ts";

export const ANTHROPIC_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri: "http://localhost:53692/callback",
  scopes:
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
} as const;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** PKCE via Web Crypto (browser-safe). */
export async function generatePkce(): Promise<Pkce> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

/** Authorize URL; the PKCE verifier doubles as the state param. */
export function buildAuthorizeUrl(pkce: Pkce): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_OAUTH.clientId,
    response_type: "code",
    redirect_uri: ANTHROPIC_OAUTH.redirectUri,
    scope: ANTHROPIC_OAUTH.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.verifier,
  });
  return `${ANTHROPIC_OAUTH.authorizeUrl}?${params.toString()}`;
}

export interface ParsedRedirect {
  code: string;
  state: string | undefined;
}

/**
 * Extract code + state from the user's pasted input. Supports:
 *  - full redirect URL (http://localhost:53692/callback?code=..&state=..)
 *  - "code#state"
 *  - "code=..&state=.."
 *  - a bare code
 */
export function parseRedirect(input: string): ParsedRedirect {
  const trimmed = input.trim();
  if (trimmed.includes("://")) {
    const url = new URL(trimmed);
    return { code: url.searchParams.get("code") ?? "", state: url.searchParams.get("state") ?? undefined };
  }
  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#");
    return { code: code ?? "", state: state || undefined };
  }
  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed);
    return { code: params.get("code") ?? "", state: params.get("state") ?? undefined };
  }
  return { code: trimmed, state: undefined };
}

async function postJson(url: string, body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OAuth HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

function toCredential(data: { access_token: string; refresh_token: string; expires_in: number }): OAuthCredential {
  return {
    type: "oauth",
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

export async function exchangeCode(opts: {
  code: string;
  state: string;
  verifier: string;
}): Promise<OAuthCredential> {
  const data = await postJson(ANTHROPIC_OAUTH.tokenUrl, {
    grant_type: "authorization_code",
    client_id: ANTHROPIC_OAUTH.clientId,
    code: opts.code,
    state: opts.state,
    redirect_uri: ANTHROPIC_OAUTH.redirectUri,
    code_verifier: opts.verifier,
  });
  return toCredential(data);
}

export async function refreshToken(refresh: string): Promise<OAuthCredential> {
  const data = await postJson(ANTHROPIC_OAUTH.tokenUrl, {
    grant_type: "refresh_token",
    client_id: ANTHROPIC_OAUTH.clientId,
    refresh_token: refresh,
  });
  return toCredential(data);
}
