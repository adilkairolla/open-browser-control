/**
 * Mock data for the UI playground. Deliberately self-contained (no pi import)
 * so `bun dev` renders the chat without any provider credentials.
 */
import type { UiMessage, UiModel, UiProvider } from "@/components/chat/types";
import type { ProviderEntry } from "@/components/chat/ProvidersView";
import type { ConversationSummary } from "@/lib/sessions/types";

export const providers: UiProvider[] = [
  { slug: "openrouter", name: "OpenRouter" },
  { slug: "anthropic", name: "Anthropic" },
  { slug: "openai", name: "OpenAI" },
  { slug: "google", name: "Google Gemini" },
  { slug: "groq", name: "Groq" },
  { slug: "xai", name: "xAI" },
  { slug: "deepseek", name: "DeepSeek" },
];

export const modelsByProvider: Record<string, UiModel[]> = {
  openrouter: [
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "openai/gpt-5.2", name: "GPT-5.2" },
    { id: "openai/gpt-5.2-mini", name: "GPT-5.2 Mini" },
    { id: "openai/o4", name: "o4" },
    { id: "google/gemini-3-pro", name: "Gemini 3 Pro" },
    { id: "google/gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "meta-llama/llama-4-405b", name: "Llama 4 405B" },
    { id: "mistralai/mistral-large-3", name: "Mistral Large 3" },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "x-ai/grok-4", name: "Grok 4" },
    { id: "qwen/qwen3-max", name: "Qwen3 Max" },
  ],
  anthropic: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8 (1M context)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ],
  openai: [
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "o4", name: "o4" },
  ],
  google: [
    { id: "gemini-3-pro", name: "Gemini 3 Pro" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
  ],
  groq: [
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "mixtral-8x7b", name: "Mixtral 8x7B" },
  ],
  xai: [
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-3-mini", name: "Grok 3 Mini" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek V3" },
    { id: "deepseek-reasoner", name: "DeepSeek R1" },
  ],
};

export const suggestions = [
  "What's causing this error?",
  "Is the contrast strong enough?",
  "Summarize this page",
  "Explain the selected code",
];

/** A sample thread that includes a long unbreakable URL to stress-test wrapping. */
export const sampleConversation: UiMessage[] = [
  { id: "m1", role: "user", text: "My laptop's been super slow since yesterday. Help me troubleshoot." },
  {
    id: "m2",
    role: "assistant",
    text: "Let's troubleshoot like tech ninjas 🥷\n\nFirst question: did you install or update anything recently?",
  },
  { id: "m3", role: "user", text: "I installed a few Chrome extensions and updated Zoom." },
  {
    id: "m4",
    role: "assistant",
    text:
      "Chrome extensions… the usual suspects. Let's try this:\n\n1. Disable unnecessary extensions\n2. Clear the browser cache\n3. Restart your laptop\n\nAlso, how's your disk space? You can check the guide at https://support.example.com/disk-cleanup/a-very-long-path-that-should-wrap-instead-of-overflowing-the-panel",
  },
];

/** Provider metadata for the Providers view (mirrors lib/providers CURATED_PROVIDERS). */
const PROVIDER_META: Omit<ProviderEntry, "connected">[] = [
  { slug: "openrouter", name: "OpenRouter", authMethods: ["api_key"], apiKeyUrl: "https://openrouter.ai/keys" },
  { slug: "openai", name: "OpenAI", authMethods: ["api_key"], apiKeyUrl: "https://platform.openai.com/api-keys" },
  {
    slug: "anthropic",
    name: "Anthropic",
    authMethods: ["api_key", "oauth"],
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  { slug: "google", name: "Google Gemini", authMethods: ["api_key"], apiKeyUrl: "https://aistudio.google.com/apikey" },
  { slug: "groq", name: "Groq", authMethods: ["api_key"], apiKeyUrl: "https://console.groq.com/keys" },
  { slug: "xai", name: "xAI", authMethods: ["api_key"], apiKeyUrl: "https://console.x.ai" },
  { slug: "deepseek", name: "DeepSeek", authMethods: ["api_key"], apiKeyUrl: "https://platform.deepseek.com/api_keys" },
];

/** Build ProviderEntry[] with the given slugs marked as connected. */
export function providerEntries(connectedSlugs: string[]): ProviderEntry[] {
  return PROVIDER_META.map((m) => ({ ...m, connected: connectedSlugs.includes(m.slug) }));
}

/** Static history for the conversations-drawer demo screen. */
const HOUR = 3_600_000;
export const mockConversations: ConversationSummary[] = [
  { id: "c1", title: "Troubleshoot slow laptop", updatedAt: Date.now() - 5 * 60_000, origin: "support.example.com" },
  { id: "c2", title: "Summarize this page", updatedAt: Date.now() - 3 * HOUR, origin: "en.wikipedia.org" },
  {
    id: "c3",
    title: "Explain the selected code and suggest a cleaner approach",
    updatedAt: Date.now() - 26 * HOUR,
    origin: "github.com",
  },
  { id: "c4", title: "Draft a reply", updatedAt: Date.now() - 9 * 24 * HOUR },
];

/** Canned assistant replies for the demo's fake streaming. */
export const cannedReplies = [
  "Good question. Here's the short version: it depends on the context, but the key idea is to keep the interface focused and let the content breathe.",
  "Sure — I'd break that into three steps. First, identify the goal. Second, gather what you need. Third, iterate quickly and check the result.",
  "Here's a longer one to test wrapping and scrolling. The composer should stay pinned to the bottom while this message streams in, the list should auto-scroll, and nothing should overflow horizontally even at the narrowest panel width. Try dragging the width slider while this is on screen.",
];
