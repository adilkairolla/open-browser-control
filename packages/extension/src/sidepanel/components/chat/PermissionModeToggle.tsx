import type { PermissionMode } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface PermissionModeToggleProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  className?: string;
}

/** Compact header switch between ask (gate mutations) and yolo (auto-approve). */
export function PermissionModeToggle({ mode, onChange, className }: PermissionModeToggleProps) {
  return (
    <button
      type="button"
      title={mode === "yolo" ? "Auto-approving tool actions" : "Asking before mutating actions"}
      onClick={() => onChange(mode === "ask" ? "yolo" : "ask")}
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs",
        mode === "yolo" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {mode === "yolo" ? "YOLO" : "Ask"}
    </button>
  );
}
