import { describe, expect, test } from "bun:test";
import { CURATED_PROVIDERS, getProviderMeta, listModels } from "../src/sidepanel/lib/providers.ts";

describe("providers catalog", () => {
  test("includes the seven curated providers with openrouter first", () => {
    const slugs = CURATED_PROVIDERS.map((p) => p.slug);
    expect(slugs[0]).toBe("openrouter");
    expect(slugs).toEqual(
      expect.arrayContaining(["openrouter", "openai", "anthropic", "google", "groq", "xai", "deepseek"]),
    );
  });

  test("only anthropic supports the oauth method", () => {
    const oauthProviders = CURATED_PROVIDERS.filter((p) => p.authMethods.includes("oauth")).map((p) => p.slug);
    expect(oauthProviders).toEqual(["anthropic"]);
  });

  test("getProviderMeta resolves a known slug", () => {
    expect(getProviderMeta("openrouter")?.name).toBe("OpenRouter");
    expect(getProviderMeta("nope")).toBeUndefined();
  });

  test("listModels returns non-empty model lists with id+name for each provider", () => {
    for (const p of CURATED_PROVIDERS) {
      const models = listModels(p.slug);
      expect(models.length).toBeGreaterThan(0);
      expect(typeof models[0]!.id).toBe("string");
      expect(typeof models[0]!.name).toBe("string");
    }
  });
});
