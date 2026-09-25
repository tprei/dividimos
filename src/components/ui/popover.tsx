"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { useBackHandler } from "@/hooks/use-back-handler";
import { cn } from "@/lib/utils";

/**
 * Anchored surface for short contextual actions and previews.
 *
 * Phones show these beside the control that opened them instead of blurring
 * the screen behind a centred dialog. The backdrop is transparent but still
 * present: without it, the tap that dismisses the surface lands on whatever
 * sits underneath, which on this app means real ledger buttons.
 */

const DISMISSAL_REASONS: Record<string, true> = {
  "outside-press": true,
  "escape-key": true,
  "focus-out": true,
};

export interface PopoverProps extends PopoverPrimitive.Root.Props {
  /** When false, only explicit controls close the surface. Defaults to true. */
  dismissable?: boolean;
}

export function Popover({
  dismissable = true,
  open,
  onOpenChange,
  actionsRef,
  ...props
}: PopoverProps) {
  const ownActions = React.useRef<PopoverPrimitive.Root.Actions | null>(null);
  // Base UI takes a ref object here, so a caller-supplied ref is reused
  // directly rather than wrapped; the back handler reads whichever is active.
  const actions = actionsRef ?? ownActions;

  const handleOpenChange = React.useCallback(
    (
      nextOpen: boolean,
      eventDetails: PopoverPrimitive.Root.ChangeEventDetails,
    ) => {
      if (!dismissable && !nextOpen && DISMISSAL_REASONS[eventDetails.reason]) {
        return;
      }
      onOpenChange?.(nextOpen, eventDetails);
    },
    [dismissable, onOpenChange],
  );

  // An open surface owns the hardware back gesture even when it refuses to be
  // dismissed, so back never navigates away from a pending operation.
  const handleBack = React.useCallback(() => {
    if (!dismissable) {
      return;
    }
    actions.current?.close();
  }, [actions, dismissable]);

  useBackHandler(open === true, handleBack);

  return (
    <PopoverPrimitive.Root
      modal
      open={open}
      onOpenChange={handleOpenChange}
      actionsRef={actions}
      {...props}
    />
  );
}

export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverTitle({
  className,
  ...props
}: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-base font-bold text-foreground", className)}
      {...props}
    />
  );
}

export function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export interface PopoverContentProps extends PopoverPrimitive.Popup.Props {
  /** Element the surface is positioned against. */
  anchor?: HTMLElement | null;
  side?: "top" | "bottom" | "inline-start";
  align?: "start" | "center" | "end";
  /**
   * Base UI flips by default. Surfaces whose content changes height pin the
   * side here so they don't jump across their anchor between states.
   */
  collisionAvoidance?: PopoverPrimitive.Positioner.Props["collisionAvoidance"];
}

export function PopoverContent({
  anchor,
  side = "bottom",
  align = "center",
  collisionAvoidance,
  className,
  children,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Backdrop
        data-slot="popover-backdrop"
        className="fixed inset-0 z-40 bg-transparent"
      />
      <PopoverPrimitive.Positioner
        anchor={anchor ?? undefined}
        side={side}
        align={align}
        collisionAvoidance={collisionAvoidance}
        sideOffset={8}
        collisionPadding={12}
        positionMethod="fixed"
        className="z-50 outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          // Touch users open these from a button; focusing the popup itself
          // keeps the on-screen keyboard closed until a field is tapped.
          initialFocus
          // A row can unmount while its surface is open (navigation, refresh).
          // Base UI skips a disconnected node rather than focusing a stale one.
          finalFocus
          className={cn(
            "flex max-h-(--available-height) w-[min(22rem,calc(var(--app-viewport-width)-24px))] origin-(--transform-origin) flex-col gap-3 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none",
            "duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:duration-120 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "motion-reduce:duration-0 motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
