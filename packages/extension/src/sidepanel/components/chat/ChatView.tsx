/**
 * The chat surface (the one we're shipping).
 *
 * Minimal chat UI — assistant replies render as plain full-width text, user
 * turns sit in a subtle bubble, no avatars — with a softer, rounder treatment:
 * a pill composer and circular icon/send buttons. Tuned for narrow side-panel
 * widths (no horizontal overflow). Pure view over ChatViewProps.
 */
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatViewProps } from "./types";
import { Icon } from "./icons";
import { IconButton, MessageActions, ModelPicker, Picker, SuggestionChip } from "./primitives";
import { ProviderIcon } from "./ProviderIcon";

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const canSend = input.trim().length > 0 && !streaming;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

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
          <div className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Icon name="brand" size={26} />
          </div>
          <h1 className="text-center text-xl font-semibold tracking-tight">What can I help with?</h1>
          {suggestions && suggestions.length > 0 && (
            <div className="grid w-full max-w-sm grid-cols-2 gap-2">
              {suggestions.slice(0, 4).map((s) => (
                <SuggestionChip key={s} text={s} onClick={() => onSend(s)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ScrollArea>
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className={cn(WRAP, "max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-sm")}>
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="group">
                    <div className={cn(WRAP, "text-sm leading-relaxed")}>
                      {m.text}
                      {m.streaming && (
                        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
                      )}
                    </div>
                    {!m.streaming && m.text && (
                      <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <MessageActions text={m.text} />
                      </div>
                    )}
                  </div>
                ),
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </div>
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
              <IconButton icon="stop" label="Stop" variant="brand" className="rounded-full" onClick={onStop} />
            ) : (
              <IconButton
                icon="send"
                label="Send"
                variant="brand"
                className="rounded-full"
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
