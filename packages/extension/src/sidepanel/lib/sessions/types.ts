/** Persistent chat-history record shapes. */

export type StoredRole = "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  /** Hostname where the conversation started (e.g. "github.com"); undefined if unknown. */
  origin?: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: StoredRole;
  text: string;
  /** Monotonic order within a conversation (0, 1, 2 …). */
  seq: number;
  createdAt: number;
}

/** Lightweight projection for the history list (no message bodies). */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  origin?: string;
}
