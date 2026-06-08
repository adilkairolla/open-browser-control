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
import { groupModels, type ModelGroup, type ModelOption } from "@/lib/modelGroups";
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
          "press inline-flex shrink-0 items-center justify-center rounded-lg outline-none transition-colors",
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
      className="press rounded-2xl border bg-card px-3 py-2 text-left text-sm text-foreground/90 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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

/**
 * Searchable model picker (base-ui Combobox). Same pill trigger as Picker, but
 * the popup adds a search field and groups models by brand — essential for
 * providers like OpenRouter that expose hundreds of models across many brands.
 * Grouping/short-label parsing lives in `lib/modelGroups` (pure + tested).
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
  const groups = groupModels(items);
  const selected = groups.flatMap((g) => g.items).find((o) => o.value === value) ?? null;
  // When at least one brand header is present the headers are sticky, so the
  // list must have no top padding (otherwise a sliver of the scrolling item
  // peeks above the pinned header). Flat lists keep a little top breathing room.
  const hasGroups = groups.some((g) => g.value !== "");

  return (
    <Combobox.Root
      items={groups}
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
        <Combobox.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Combobox.Popup className="w-72 max-w-[calc(100vw-1rem)] origin-(--transform-origin) overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <Icon name="search" size={15} className="text-muted-foreground" />
              <Combobox.Input
                placeholder="Search models…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {/* Base UI keeps Empty mounted for screen-reader announcements and
                only nulls its children when matches exist; keep the padding on
                an inner wrapper so the element collapses instead of reserving
                vertical space above the list. */}
            <Combobox.Empty className="text-center text-xs text-muted-foreground">
              <div className="px-3 py-8">No models found</div>
            </Combobox.Empty>
            <Combobox.List
              className={cn(
                "scrollbar-thin max-h-[min(60vh,22rem)] overflow-y-auto overscroll-contain px-1.5 pb-1.5",
                hasGroups ? "pt-0" : "pt-1.5",
              )}
            >
              {(group: ModelGroup) => (
                <Combobox.Group key={group.value || "_ungrouped"} items={group.items} className="pb-1 last:pb-0">
                  {group.value && (
                    <Combobox.GroupLabel className="sticky top-0 z-10 -mx-1.5 bg-popover px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                      {group.value}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(item: ModelOption) => (
                      <Combobox.Item
                        key={item.value}
                        value={item}
                        className="flex min-h-8 scroll-mt-8 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.short}</span>
                        {item.free && (
                          <span className="shrink-0 rounded-full bg-success/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-success">
                            Free
                          </span>
                        )}
                        <Combobox.ItemIndicator className="shrink-0 text-success">
                          <Icon name="check" size={15} />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
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
        key={copied ? "check" : "copy"}
        icon={copied ? "check" : "copy"}
        label={copied ? "Copied" : "Copy"}
        size="sm"
        onClick={copy}
        className={cn("animate-pop", copied && "text-success hover:text-success")}
      />
    </div>
  );
}
