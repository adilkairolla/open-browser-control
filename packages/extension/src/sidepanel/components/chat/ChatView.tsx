/**
 * The chat surface (the one we're shipping).
 *
 * Minimal chat UI — assistant replies render as plain full-width text, user
 * turns sit in a subtle bubble, no avatars — with a softer, rounder treatment:
 * a pill composer and circular icon/send buttons. Tuned for narrow side-panel
 * widths (no horizontal overflow). Pure view over ChatViewProps.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatViewProps } from "./types";
import { Icon } from "./icons";
import { IconButton, ModelPicker, Picker, SuggestionChip } from "./primitives";
import { ProviderIcon } from "./ProviderIcon";
import { MessageList } from "./MessageList";

const WRAP = "whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

export function ChatView(props: ChatViewProps) {
  const {
    providers,
    models,
    provider,
    model,
    messages,
    streaming,
    suggestions,
    error,
    onSelectProvider,
    onSelectModel,
    onSend,
    onStop,
    onNewChat,
    onManageProviders,
    onOpenConversations,
    onAttach,
    headerActions,
    composerTop,
  } = props;

  const [input, setInput] = useState("");
  const canSend = input.trim().length > 0 && !streaming;

  function submit() {
    if (!canSend) return;
    onSend(input.trim());
    setInput("");
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-1 px-2 py-1.5">
        <IconButton icon="sidebar" label="Conversations" className="rounded-full" onClick={onOpenConversations} />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Picker
            ariaLabel="Provider"
            value={provider}
            onChange={onSelectProvider}
            items={providers.map((p) => ({
              id: p.slug,
              label: p.name,
              icon: <ProviderIcon slug={p.slug} className="size-3.5" />,
            }))}
            footer={
              onManageProviders
                ? {
                    label: "Manage providers…",
                    icon: <Icon name="settings" size={14} />,
                    onSelect: onManageProviders,
                  }
                : undefined
            }
          />
          <ModelPicker
            ariaLabel="Model"
            value={model}
            onChange={onSelectModel}
            items={models.map((m) => ({ id: m.id, label: m.name }))}
          />
        </div>
        {headerActions}
        <IconButton icon="newChat" label="New chat" className="rounded-full" onClick={onNewChat} />
      </header>

      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4">
          <div
            className="animate-fade-up flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"
            style={{ animationDelay: "0ms" }}
          >
            <Icon name="brand" size={26} />
          </div>
          <h1
            className="animate-fade-up text-center text-xl font-semibold tracking-tight"
            style={{ animationDelay: "60ms" }}
          >
            What can I help with?
          </h1>
          {suggestions && suggestions.length > 0 && (
            <div
              className="animate-fade-up grid w-full max-w-sm grid-cols-2 gap-2"
              style={{ animationDelay: "120ms" }}
            >
              {suggestions.slice(0, 4).map((s) => (
                <SuggestionChip key={s} text={s} onClick={() => onSend(s)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <MessageList messages={messages} streaming={streaming} />
      )}

      <div className="px-3 pb-3 pt-1">
        {composerTop}
        {error && <p className={cn(WRAP, "mb-1.5 px-1 text-xs text-destructive")}>{error}</p>}
        <div className="rounded-3xl border bg-card p-2 shadow-sm transition-colors focus-within:border-ring/60">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything"
            className="field-sizing-content max-h-40 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-1 flex items-center gap-1">
            <IconButton icon="attach" label="Attach" size="sm" className="rounded-full" onClick={onAttach} />
            <div className="flex-1" />
            {streaming ? (
              <IconButton
                key="stop"
                icon="stop"
                label="Stop"
                variant="brand"
                className="animate-pop rounded-full"
                onClick={onStop}
              />
            ) : (
              <IconButton
                key="send"
                icon="send"
                label="Send"
                variant="brand"
                className="animate-pop rounded-full"
                disabled={!canSend}
                onClick={submit}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
