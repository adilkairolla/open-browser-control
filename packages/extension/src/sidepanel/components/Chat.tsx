import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatSession } from "@/lib/chat";
import { cn } from "@/lib/utils";

export function Chat({ session }: { session: ChatSession }) {
  const [, force] = useState(0);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => session.subscribe(() => force((n) => n + 1)), [session]);

  const messages = session.getMessages();
  const streaming = session.isStreaming();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await session.send(text);
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-secondary text-secondary-foreground",
              )}
            >
              {m.text || (m.role === "assistant" && streaming ? "…" : "")}
            </div>
          ))}
          {session.error() && <p className="text-sm text-destructive">{session.error()}</p>}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
          className="min-h-9 flex-1 resize-none"
          placeholder="Message…"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <Button variant="secondary" onClick={() => session.abort()}>
            Stop
          </Button>
        ) : (
          <Button onClick={() => void send()} disabled={!input.trim()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
