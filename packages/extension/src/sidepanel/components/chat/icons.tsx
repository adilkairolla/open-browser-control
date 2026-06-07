/**
 * Single place that maps friendly names to hugeicons glyphs, plus a thin
 * <Icon> wrapper. Import `Icon` and reference by name so swapping a glyph is a
 * one-line change and we never sprinkle raw hugeicons imports across the UI.
 */
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  AiMagicIcon,
  BulbIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Globe02Icon,
  Mic01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Settings01Icon,
  SidebarLeft01Icon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Unlink03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

const ICONS = {
  send: ArrowUp01Icon,
  attach: Attachment01Icon,
  web: Globe02Icon,
  more: MoreHorizontalIcon,
  newChat: PencilEdit01Icon,
  add: PlusSignIcon,
  stop: SquareIcon,
  copy: Copy01Icon,
  thumbsUp: ThumbsUpIcon,
  thumbsDown: ThumbsDownIcon,
  retry: ArrowReloadHorizontalIcon,
  sidebar: SidebarLeft01Icon,
  settings: Settings01Icon,
  brand: AiMagicIcon,
  mic: Mic01Icon,
  close: Cancel01Icon,
  chevronDown: ArrowDown01Icon,
  chevronRight: ArrowRight01Icon,
  back: ArrowLeft01Icon,
  check: CheckmarkCircle02Icon,
  disconnect: Unlink03Icon,
  bulb: BulbIcon,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={ICONS[name] as unknown as IconSvgElement}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
    />
  );
}
