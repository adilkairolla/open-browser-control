/**
 * Presentational contract for the chat surface.
 *
 * ChatView is a pure view over this shape. The demo playground feeds it mock
 * data; the real app adapts a ChatSession into the same props. Keeping the view
 * free of pi/ChatSession means we can iterate on the UI with `bun dev` and no
 * provider credentials.
 */

export type ChatRole = "user" | "assistant";

export interface UiMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** True for the in-flight assistant reply currently being streamed. */
  streaming?: boolean;
}

export interface UiProvider {
  slug: string;
  name: string;
}

export interface UiModel {
  id: string;
  name: string;
}

export interface ChatViewProps {
  providers: UiProvider[];
  models: UiModel[];
  provider: string;
  model: string;
  messages: UiMessage[];
  /** Whether an assistant reply is currently streaming. */
  streaming: boolean;
  /** Optional starter prompts shown on the empty state. */
  suggestions?: string[];
  /** Latest error to surface above the composer, if any. */
  error?: string;

  onSelectProvider: (slug: string) => void;
  onSelectModel: (id: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat?: () => void;
  /** Open the full-panel Providers view to add/manage providers. */
  onManageProviders?: () => void;
  /** Open the conversations drawer (placeholder until history lands). */
  onOpenConversations?: () => void;
  /** Attach files to the message (placeholder until attachments land). */
  onAttach?: () => void;
}
