/**
 * One tool call in the transcript: a collapsed pill (per-tool icon, label, args
 * summary, status) that expands to raw args + result. Screenshot results render
 * as an inline thumbnail. Expansion is local; the virtualizer re-measures on
 * toggle via its ResizeObserver.
 */
import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { TOOL_ICON, TOOL_LABEL, summarizeArgs, truncate } from "./toolMeta";

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  result?: { text?: string; image?: { data: string; mimeType: string } };
  error?: string;
}

function StatusIcon({ status }: { status: ToolCallView["status"] }) {
  if (status === "running") return <Spinner className="size-3.5 text-muted-foreground" />;
  if (status === "error")
    return <Icon key="error" name="close" size={14} className="animate-pop text-destructive" />;
  return <Icon key="ok" name="check" size={14} className="animate-pop text-success" />;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export function ToolCallCard({ tool }: { tool: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[tool.name] ?? tool.name;
  const icon = TOOL_ICON[tool.name] ?? "settings";
  const summary = summarizeArgs(tool.name, tool.args);

  return (
    <div className="animate-tool-in rounded-xl border bg-card/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name={icon} size={14} className="text-muted-foreground" />
        <span className="font-medium">{label}</span>
        {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusIcon status={tool.status} />
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "text-muted-foreground transition-transform duration-200 ease-[var(--ease-out)]",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {/* Expand/collapse via grid-rows 0fr↔1fr — animates to content height with
          no height:auto hack, on the compositor. Inner wrapper clips while
          collapsed. The virtualizer re-measures via its ResizeObserver. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out)]",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "space-y-2 border-t px-2.5 py-2 transition-opacity duration-200 ease-[var(--ease-out)]",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            <Field label="args">
              <pre className="overflow-x-auto rounded bg-secondary p-2 font-mono text-[11px] leading-snug">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </Field>
            {tool.error && (
              <Field label="error">
                <span className="text-destructive">{tool.error}</span>
              </Field>
            )}
            {tool.result?.text && !tool.error && (
              <Field label="result">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2 font-mono text-[11px] leading-snug">
                  {truncate(tool.result.text, 2000)}
                </pre>
              </Field>
            )}
            {tool.result?.image && (
              <Field label="screenshot">
                <img
                  src={`data:${tool.result.image.mimeType};base64,${tool.result.image.data}`}
                  alt="screenshot result"
                  className="max-h-48 w-auto rounded border"
                />
              </Field>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
