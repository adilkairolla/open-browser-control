/**
 * Small shared building blocks for the chat layouts. Built as plain elements
 * (not the coss Button) so they stay compact at side-panel widths, where the
 * `sm:` breakpoint never activates.
 */
import { useState, type ReactNode } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Select, SelectItem, SelectPopup, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons";

// Sentinel value for the optional footer action item (never a real selection).
const PICKER_FOOTER = "__picker_footer__";

type IconButtonSize = "sm" | "md" | "lg";

const ICON_BUTTON_DIMS: Record<IconButtonSize, { box: string; glyph: number }> = {
  sm: { box: "size-7", glyph: 16 },
  md: { box: "size-8", glyph: 18 },
  lg: { box: "size-9", glyph: 20 },
};

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  size = "md",
  variant = "ghost",
  className,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  size?: IconButtonSize;
  variant?: "ghost" | "primary" | "brand";
  className?: string;
}) {
  const dims = ICON_BUTTON_DIMS[size];
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-40",
          variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
          variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
          variant === "brand" && "bg-brand text-brand-foreground hover:bg-brand/90",
          dims.box,
          className,
        )}
      >
        <Icon name={icon} size={dims.glyph} />
      </button>
    </Tooltip>
  );
}

export function SuggestionChip({ text, onClick }: { text: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border bg-card px-3 py-2 text-left text-sm text-foreground/90 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      {text}
    </button>
  );
}

/**
 * A compact pill-style dropdown (provider or model). Truncates its label so a
 * long model name can never blow out the header width.
 */
export interface PickerItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function Picker({
  value,
  items,
  onChange,
  ariaLabel,
  tone = "muted",
  className,
  footer,
}: {
  value: string;
  items: PickerItem[];
  onChange: (id: string) => void;
  ariaLabel: string;
  tone?: "muted" | "ghost";
  className?: string;
  footer?: { label: string; icon?: ReactNode; onSelect: () => void };
}) {
  const current = items.find((i) => i.id === value);
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const id = v as string;
        if (footer && id === PICKER_FOOTER) {
          footer.onSelect();
          return;
        }
        onChange(id);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className={cn(
          "h-7 min-h-0 w-auto min-w-0 max-w-[170px] gap-1.5 rounded-full border-transparent px-2.5 text-xs font-medium shadow-none before:hidden",
          // Shrink only the trailing chevron, not the leading provider glyph.
          "[&_[data-slot=select-icon]_svg]:size-3",
          tone === "muted" ? "bg-secondary hover:bg-accent" : "bg-transparent hover:bg-accent",
          className,
        )}
      >
        {current?.icon}
        <span className="truncate">{current?.label ?? value}</span>
      </SelectTrigger>
      <SelectPopup className="p-1">
        {items.map((i) => (
          <SelectItem
            key={i.id}
            value={i.id}
            className="min-h-7 py-1 text-xs [&_svg:not([class*='size-'])]:size-3.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              {i.icon}
              <span className="truncate">{i.label}</span>
            </span>
          </SelectItem>
        ))}
        {footer && (
          <>
            <SelectSeparator />
            <SelectItem
              value={PICKER_FOOTER}
              className="min-h-7 py-1 text-xs text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                {footer.icon}
                <span className="truncate">{footer.label}</span>
              </span>
            </SelectItem>
          </>
        )}
      </SelectPopup>
    </Select>
  );
}

interface ModelOption {
  value: string;
  label: string;
}

/**
 * Searchable model picker (base-ui Combobox). Same pill trigger as Picker, but
 * the popup has a search field — essential for providers like OpenRouter that
 * expose hundreds of models.
 */
export function ModelPicker({
  value,
  items,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  items: { id: string; label: string }[];
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const options: ModelOption[] = items.map((i) => ({ value: i.id, label: i.label }));
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(v) => {
        const opt = v as ModelOption | null;
        if (opt) onChange(opt.value);
      }}
      isItemEqualToValue={(a, b) => (a as ModelOption | null)?.value === (b as ModelOption | null)?.value}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-[170px] cursor-pointer items-center gap-1 rounded-full border border-transparent bg-secondary px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <Combobox.Value placeholder="Model" />
        </span>
        <Combobox.Icon className="shrink-0 text-muted-foreground">
          <Icon name="chevronDown" size={12} />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Combobox.Popup className="w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
            <div className="border-b p-1.5">
              <Combobox.Input
                placeholder="Search models…"
                className="w-full rounded-md bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
              No models found
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto p-1">
              {(item: ModelOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="flex min-h-7 cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="truncate">{item.label}</span>
                  <Combobox.ItemIndicator className="shrink-0 text-success">
                    <Icon name="check" size={14} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** Hover/last-message action row under an assistant reply. Copy is wired with
 *  a brief confirmation; only real, working actions are shown. */
export function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable; fail silently.
    }
  }

  return (
    <div className="mt-1 flex items-center gap-0.5">
      <IconButton
        icon={copied ? "check" : "copy"}
        label={copied ? "Copied" : "Copy"}
        size="sm"
        onClick={copy}
        className={copied ? "text-success hover:text-success" : undefined}
      />
    </div>
  );
}
