/**
 * The virtualized transcript. Owns the TanStack virtualizer (hosted in the
 * existing base-ui ScrollArea via a forwarded viewport ref), dynamic row
 * measurement (markdown/code heights vary), stick-to-bottom auto-scroll during
 * streaming, and a floating jump-to-bottom button when the user scrolls away.
 *
 * User rows stay plain text; assistant rows render markdown. Spacing between
 * rows lives in per-row padding (`pb-4`) because flex `gap` does not survive the
 * absolute positioning the virtualizer requires.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { isNearBottom } from "@/lib/autoscroll";
import type { UiMessage } from "./types";
import { Markdown } from "./Markdown";
import { MessageActions } from "./primitives";
import { Icon } from "./icons";

const WRAP = "whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

export function MessageList({ messages, streaming }: { messages: UiMessage[]; streaming: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 80,
    overscan: 6,
    getItemKey: (index) => messages[index]!.id,
  });

  // Track whether the user is pinned to the bottom (drives auto-scroll + the
  // jump button). Bound once to the viewport node the ScrollArea forwards.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
      setStick(near);
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Re-pin to the bottom while sticking. Fires on a new message and on each
  // streamed token (the last row's text — and thus measured height — grows).
  const lastText = messages[messages.length - 1]?.text ?? "";
  useLayoutEffect(() => {
    if (!stick || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length, lastText, stick, virtualizer]);

  const jumpToBottom = () => {
    setStick(true);
    setAtBottom(true);
    if (messages.length > 0) virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  };

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea viewportRef={viewportRef}>
        <div className="mx-auto w-full max-w-2xl px-3 py-4">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const m = messages[item.index]!;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-4"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className={cn(WRAP, "max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-sm")}>
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div className="group">
                      <Markdown text={m.text} streaming={!!m.streaming} />
                      {!m.streaming && m.text && (
                        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <MessageActions text={m.text} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      {!atBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent"
        >
          <Icon name="chevronDown" size={14} />
          {streaming ? "New messages" : "Jump to latest"}
        </button>
      )}
    </div>
  );
}
