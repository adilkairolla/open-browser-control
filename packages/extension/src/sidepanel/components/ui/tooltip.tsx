"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

// 400ms first-hover delay prevents accidental activation; base-ui keeps the
// group "warm" so adjacent tooltips open instantly while one is already open.
export function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={400} closeDelay={0} {...props} />;
}

/**
 * Lightweight styled tooltip. `children` must be a single focusable element
 * (e.g. a <button>) — base-ui merges trigger props/ref onto it.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-50">
          <TooltipPrimitive.Popup
            className={cn(
              "origin-(--transform-origin) select-none rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md transition-[transform,opacity] duration-[125ms] ease-[var(--ease-out)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
