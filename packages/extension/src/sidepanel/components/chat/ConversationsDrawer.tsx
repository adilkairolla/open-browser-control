/**
 * Slide-over history panel opened from the header's Conversations icon. Lists
 * stored conversations newest-first; supports open, delete, and starting a new
 * chat. Presentational — all data/handlers come from props (App wires the
 * SessionManager via useSessions).
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/sessions/types";
import { EASE_DRAWER, EASE_OUT } from "@/lib/motion";
import { IconButton } from "./primitives";

export interface ConversationsDrawerProps {
  open: boolean;
  conversations: ConversationSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function ConversationsDrawer({
  open,
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
  onClose,
}: ConversationsDrawerProps) {
  const reduce = useReducedMotion();
  const panelHidden = reduce ? { opacity: 0 } : { opacity: 0, transform: "translateX(-100%)" };
  const panelShown = { opacity: 1, transform: "translateX(0%)" };

  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-40 flex">
          {/* Scrim */}
          <motion.button
            type="button"
            aria-label="Close conversations"
            onClick={onClose}
            className="absolute inset-0 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          />
          {/* Panel */}
          <motion.div
            className="relative flex h-full w-72 max-w-[85%] flex-col border-r bg-background shadow-xl"
            initial={panelHidden}
            animate={panelShown}
            exit={panelHidden}
            transition={{ duration: 0.3, ease: EASE_DRAWER }}
          >
            <header className="flex items-center gap-1 border-b px-2 py-1.5">
              <span className="flex-1 px-1 text-sm font-semibold">Conversations</span>
              <IconButton icon="newChat" label="New chat" size="sm" className="rounded-full" onClick={onNewChat} />
              <IconButton icon="close" label="Close" size="sm" className="rounded-full" onClick={onClose} />
            </header>

            {conversations.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
                No conversations yet. Your chats will show up here.
              </div>
            ) : (
              <ul className="flex-1 overflow-y-auto p-1.5">
                {conversations.map((c) => (
                  <li key={c.id} className="group/item">
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent",
                        c.id === activeId && "bg-secondary",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className="flex min-w-0 flex-1 flex-col items-start text-left outline-none"
                      >
                        <span className="w-full truncate text-sm text-foreground">{c.title}</span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {c.origin && <span className="truncate">{c.origin}</span>}
                          {c.origin && <span aria-hidden>·</span>}
                          <span>{relativeTime(c.updatedAt)}</span>
                        </span>
                      </button>
                      <IconButton
                        icon="close"
                        label="Delete conversation"
                        size="sm"
                        className="rounded-full opacity-0 transition-opacity group-hover/item:opacity-100"
                        onClick={() => onDelete(c.id)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
