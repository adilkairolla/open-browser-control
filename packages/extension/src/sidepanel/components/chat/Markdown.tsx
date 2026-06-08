/**
 * Renders assistant message text as markdown via Streamdown. The single place
 * markdown is configured: Shiki highlighting (the opt-in `code` plugin only —
 * mermaid/math stay out of the bundle), incomplete-markdown hardening for
 * streaming, and a className that tunes typographic rhythm to our design tokens
 * for the narrow side panel.
 */
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { cn } from "@/lib/utils";

// Prose rhythm + token mapping. Code blocks (`pre`) are left to the Shiki plugin
// (it sets the themed background); we only constrain inline code, links, lists,
// tables (which must scroll horizontally in a narrow panel), and spacing.
const PROSE = cn(
  "text-sm leading-relaxed text-foreground break-words [overflow-wrap:anywhere]",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-80",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:text-xs",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_table]:my-2 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-xs",
  "[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-3 [&_hr]:border-border",
);

export function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown
      plugins={{ code }}
      isAnimating={streaming}
      parseIncompleteMarkdown
      controls
      shikiTheme={["github-light", "github-dark"]}
      className={PROSE}
    >
      {text}
    </Streamdown>
  );
}
