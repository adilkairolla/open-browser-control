/**
 * Monochrome brand glyphs for the curated providers (lobehub static SVGs).
 *
 * The SVGs ship with `fill="currentColor"`, so they're inlined (not <img>) to
 * inherit the surrounding text color — which keeps them legible in both light
 * and dark themes and visually consistent with the hugeicons line icons.
 */
import openrouter from "@/assets/providers/openrouter.svg?raw";
import openai from "@/assets/providers/openai.svg?raw";
import anthropic from "@/assets/providers/anthropic.svg?raw";
import google from "@/assets/providers/google.svg?raw";
import groq from "@/assets/providers/groq.svg?raw";
import xai from "@/assets/providers/xai.svg?raw";
import deepseek from "@/assets/providers/deepseek.svg?raw";
import { cn } from "@/lib/utils";

const RAW: Record<string, string> = {
  openrouter,
  openai,
  anthropic,
  google,
  groq,
  xai,
  deepseek,
};

export function ProviderIcon({ slug, className }: { slug: string; className?: string }) {
  const svg = RAW[slug];
  if (!svg) return null;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
