/**
 * Ordered transcript-item model for the chat UI, built purely from pi agent
 * state. Replaces the lossy text-only view: emits a text item per non-empty
 * text block and a tool item per toolCall block, merging tool results by
 * toolCallId. Kept free of React/DOM so it is unit-tested directly.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type ToolStatus = "running" | "ok" | "error";

export interface ToolResultView {
  text?: string;
  image?: { data: string; mimeType: string };
}

export interface TranscriptText {
  kind: "text";
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface TranscriptTool {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: ToolResultView;
  error?: string;
}

export type TranscriptItem = TranscriptText | TranscriptTool;

type Content = string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

function joinText(content: Content): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

function firstImage(content: Content): { data: string; mimeType: string } | undefined {
  if (typeof content === "string") return undefined;
  const img = content.find((p) => p.type === "image" && typeof p.data === "string");
  return img ? { data: img.data as string, mimeType: img.mimeType ?? "image/png" } : undefined;
}

/** Flatten pi messages (+ the in-flight streaming message) into ordered items. */
export function buildTranscript(messages: AgentMessage[], streaming?: AgentMessage): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const byCallId = new Map<string, TranscriptTool>();
  let textN = 0;
  const all = streaming ? [...messages, streaming] : messages;

  for (const msg of all as any[]) {
    if (msg.role === "user") {
      const text = joinText(msg.content);
      if (text) items.push({ kind: "text", id: `t${textN++}`, role: "user", text });
    } else if (msg.role === "assistant") {
      for (const block of msg.content as any[]) {
        if (block.type === "text" && block.text) {
          items.push({ kind: "text", id: `t${textN++}`, role: "assistant", text: block.text });
        } else if (block.type === "toolCall") {
          const item: TranscriptTool = {
            kind: "tool",
            id: block.id,
            name: block.name,
            args: (block.arguments as Record<string, unknown>) ?? {},
            status: "running",
          };
          items.push(item);
          byCallId.set(block.id, item);
        }
      }
    } else if (msg.role === "toolResult") {
      const item = byCallId.get(msg.toolCallId);
      if (item) {
        const text = joinText(msg.content);
        const image = firstImage(msg.content);
        item.status = msg.isError ? "error" : "ok";
        item.result = { text: text || undefined, image };
        if (msg.isError) item.error = text || undefined;
      }
    }
  }
  return items;
}
