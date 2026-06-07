import { afterEach, describe, expect, test } from "bun:test";
import {
  generatePkce,
  buildAuthorizeUrl,
  parseRedirect,
  exchangeCode,
  refreshToken,
  ANTHROPIC_OAUTH,
} from "../src/sidepanel/lib/oauthAnthropic.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("anthropic oauth", () => {
  test("generatePkce returns base64url verifier+challenge", async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toBe(challenge);
  });

  test("buildAuthorizeUrl includes all required params and code=true", () => {
    const url = new URL(buildAuthorizeUrl({ verifier: "VER", challenge: "CHAL" }));
    expect(url.origin + url.pathname).toBe(ANTHROPIC_OAUTH.authorizeUrl);
    const p = url.searchParams;
    expect(p.get("code")).toBe("true");
    expect(p.get("client_id")).toBe(ANTHROPIC_OAUTH.clientId);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("redirect_uri")).toBe(ANTHROPIC_OAUTH.redirectUri);
    expect(p.get("scope")).toBe(ANTHROPIC_OAUTH.scopes);
    expect(p.get("code_challenge")).toBe("CHAL");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBe("VER");
  });

  test("parseRedirect handles a full URL", () => {
    expect(parseRedirect("http://localhost:53692/callback?code=AC&state=ST")).toEqual({
      code: "AC",
      state: "ST",
    });
  });

  test("parseRedirect handles code#state", () => {
    expect(parseRedirect("AC#ST")).toEqual({ code: "AC", state: "ST" });
  });

  test("parseRedirect handles a bare code", () => {
    expect(parseRedirect("  AC  ")).toEqual({ code: "AC", state: undefined });
  });

  test("exchangeCode posts the correct body and maps the response", async () => {
    let captured: { url: string; body: unknown } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string) };
      return new Response(
        JSON.stringify({ access_token: "sk-ant-oat-A", refresh_token: "R", expires_in: 3600 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const before = Date.now();
    const cred = await exchangeCode({ code: "AC", state: "VER", verifier: "VER" });
    expect(captured?.url).toBe(ANTHROPIC_OAUTH.tokenUrl);
    expect(captured?.body).toEqual({
      grant_type: "authorization_code",
      client_id: ANTHROPIC_OAUTH.clientId,
      code: "AC",
      state: "VER",
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      code_verifier: "VER",
    });
    expect(cred.type).toBe("oauth");
    expect(cred.access).toBe("sk-ant-oat-A");
    expect(cred.refresh).toBe("R");
    expect(cred.expires).toBeGreaterThan(before + 3600_000 - 300_000 - 5_000);
    expect(cred.expires).toBeLessThan(before + 3600_000 - 300_000 + 5_000);
  });

  test("refreshToken posts refresh_token grant without scope", async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ access_token: "sk-ant-oat-B", refresh_token: "R2", expires_in: 3600 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const cred = await refreshToken("R");
    expect(body).toEqual({
      grant_type: "refresh_token",
      client_id: ANTHROPIC_OAUTH.clientId,
      refresh_token: "R",
    });
    expect(body).not.toHaveProperty("scope");
    expect(cred.access).toBe("sk-ant-oat-B");
  });
});
