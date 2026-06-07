import type { ApprovalDecision, PendingApproval } from "@/lib/permissions";
import { cn } from "@/lib/utils";

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

/** Inline approval prompt shown above the composer in `ask` mode. */
export function ToolApprovalCard({ pending, onDecide, className }: ToolApprovalCardProps) {
  const action = VERB[pending.tool] ?? pending.tool;
  const where = pending.origin ? ` on ${pending.origin}` : "";
  return (
    <div className={cn("mb-1.5 rounded-xl border bg-card p-3 text-sm shadow-sm", className)}>
      <p className="mb-2">
        Allow Claude to <span className="font-medium">{action}</span>
        {where}?
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-white"
          onClick={() => onDecide(pending.id, "once")}
        >
          Allow once
        </button>
        {pending.origin && (
          <button
            className="rounded-full border px-3 py-1 text-xs"
            onClick={() => onDecide(pending.id, "always")}
          >
            Always allow on this site
          </button>
        )}
        <button
          className="rounded-full border px-3 py-1 text-xs text-destructive"
          onClick={() => onDecide(pending.id, "deny")}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
