import { getModels } from "@earendil-works/pi-ai";
import type { KnownProvider, Model, Api } from "@earendil-works/pi-ai";

export type AuthMethod = "api_key" | "oauth";

export interface ProviderMeta {
  slug: KnownProvider;
  name: string;
  authMethods: AuthMethod[];
  /** Where the user gets an API key (shown in the connect dialog). */
  apiKeyUrl?: string;
}

/** OpenRouter first (the north star); anthropic also supports subscription OAuth. */
export const CURATED_PROVIDERS: ProviderMeta[] = [
  { slug: "openrouter", name: "OpenRouter", authMethods: ["api_key"], apiKeyUrl: "https://openrouter.ai/keys" },
  { slug: "openai", name: "OpenAI", authMethods: ["api_key"], apiKeyUrl: "https://platform.openai.com/api-keys" },
  { slug: "anthropic", name: "Anthropic", authMethods: ["api_key", "oauth"], apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  { slug: "google", name: "Google Gemini", authMethods: ["api_key"], apiKeyUrl: "https://aistudio.google.com/apikey" },
  { slug: "groq", name: "Groq", authMethods: ["api_key"], apiKeyUrl: "https://console.groq.com/keys" },
  { slug: "xai", name: "xAI", authMethods: ["api_key"], apiKeyUrl: "https://console.x.ai" },
  { slug: "deepseek", name: "DeepSeek", authMethods: ["api_key"], apiKeyUrl: "https://platform.deepseek.com/api_keys" },
];

export function getProviderMeta(slug: string): ProviderMeta | undefined {
  return CURATED_PROVIDERS.find((p) => p.slug === slug);
}

/** Models for a provider, sorted by display name, from pi's static catalog. */
export function listModels(slug: KnownProvider): Model<Api>[] {
  return [...getModels(slug)].sort((a, b) => a.name.localeCompare(b.name));
}
