import { motion, useReducedMotion } from "motion/react";
import type { ApprovalDecision, PendingApproval } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/lib/motion";
import { Icon, type IconName } from "./icons";
import { TOOL_ICON } from "./toolMeta";

export interface ToolApprovalCardProps {
  pending: PendingApproval;
  onDecide: (id: string, decision: ApprovalDecision) => void;
  className?: string;
}

const VERB: Record<string, string> = {
  navigate: "navigate",
  click: "click an element",
  type: "type text",
};

/**
 * Inline approval prompt shown above the composer in `ask` mode.
 *
 * Layout: a tool-icon header poses the question, then a balanced `Deny` /
 * `Allow once` primary row (each half-width — Allow filled, Deny quiet until
 * hovered), with the more consequential "always allow" as a subtle full-width
 * action underneath. This keeps the three choices from wrapping awkwardly at
 * narrow side-panel widths.
 */
export function ToolApprovalCard({ pending, onDecide, className }: ToolApprovalCardProps) {
  const action = VERB[pending.tool] ?? pending.tool;
  const icon: IconName = TOOL_ICON[pending.tool] ?? "ask";
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={cn("mb-1.5 rounded-2xl border bg-card p-3 shadow-sm", className)}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon name={icon} size={15} />
        </span>
        <p className="pt-0.5 text-sm leading-snug text-foreground">
          Allow the agent to <span className="font-semibold">{action}</span>
          {pending.origin && (
            <>
              {" on "}
              <span className="font-semibold">{pending.origin}</span>
            </>
          )}
          ?
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onDecide(pending.id, "deny")}
            className="press h-8 flex-1 rounded-lg border text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onDecide(pending.id, "once")}
            className="press h-8 flex-1 rounded-lg bg-brand text-xs font-semibold text-brand-foreground outline-none transition-colors hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            Allow once
          </button>
        </div>
        {pending.origin && (
          <button
            type="button"
            onClick={() => onDecide(pending.id, "always")}
            className="press flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="web" size={13} />
            Always allow on this site
          </button>
        )}
      </div>
    </motion.div>
  );
}
