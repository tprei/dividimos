"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { useBackHandler } from "@/hooks/use-back-handler"

function Dialog({
  onOpenChange,
  dismissable = true,
  ...props
}: DialogPrimitive.Root.Props & { dismissable?: boolean }) {
  const handleHardwareBack = React.useCallback(() => {
    onOpenChange?.(false, {
      reason: "escape-key",
      event: new KeyboardEvent("keydown", { key: "Escape" }),
      cancel: () => {},
      allowPropagation: () => {},
      isCanceled: false,
      isPropagationAllowed: false,
      trigger: undefined,
      preventUnmountOnClose: () => {},
    });
  }, [onOpenChange]);
  useBackHandler(props.open ?? false, () => {
    if (!dismissable) return;
    handleHardwareBack();
  });

  const handleOpenChange = React.useCallback(
    (open: boolean, event: Parameters<NonNullable<DialogPrimitive.Root.Props["onOpenChange"]>>[1]) => {
      if (!open && !dismissable) return;
      onOpenChange?.(open, event);
    },
    [onOpenChange, dismissable],
  );

  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      onOpenChange={handleOpenChange}
      {...props}
    />
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant = "center",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  variant?: "center" | "sheet"
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed z-50 flex min-h-0 w-full flex-col gap-3 overflow-y-auto overscroll-contain border-border bg-card text-sm shadow-lg outline-none motion-reduce:animate-none",
          variant === "center"
            ? // Anchored to the visual viewport rather than the layout
              // viewport: with the keyboard open the two differ by half the
              // screen.
              "border left-1/2 top-[calc(var(--app-viewport-top)+var(--app-viewport-height)/2)] max-h-[calc(var(--app-viewport-height)-var(--safe-area-inset-top,env(safe-area-inset-top,0px))-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))-1.5rem)] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-4 duration-200 sm:max-w-md motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:zoom-in-95 data-closed:duration-120 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95"
            : "border-t sm:border left-0 top-[calc(var(--app-viewport-top)+var(--app-viewport-height))] max-h-[calc(var(--app-viewport-height)-var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] max-w-none -translate-y-full rounded-t-3xl rounded-b-none px-6 pt-5 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] motion-safe:duration-200 motion-safe:data-open:animate-in motion-safe:data-open:slide-in-from-bottom-4 motion-safe:data-closed:animate-out motion-safe:data-closed:slide-out-to-bottom-4 sm:left-1/2 sm:top-[calc(var(--app-viewport-top)+var(--app-viewport-height)/2)] sm:max-h-[calc(var(--app-viewport-height)-var(--safe-area-inset-top,env(safe-area-inset-top,0px))-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))-1.5rem)] sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-4 sm:motion-safe:duration-100 sm:motion-safe:data-open:fade-in-0 sm:motion-safe:data-open:zoom-in-95 sm:motion-safe:data-closed:fade-out-0 sm:motion-safe:data-closed:zoom-out-95",
          // Only the row the close control actually sits on gives up width to
          // it. Padding the whole popup indents every field and button, which
          // reads as a lopsided dialog.
          showCloseButton &&
            (variant === "center"
              ? "[&>[data-slot=dialog-header]]:pr-11"
              : "sm:[&>[data-slot=dialog-header]]:pr-11"),
          className
        )}
        {...props}
      >
        {variant === "sheet" && (
          <div
            aria-hidden="true"
            className="mx-auto h-1.5 w-12 shrink-0 rounded-full bg-muted sm:hidden"
          />
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className={cn(
                  "absolute top-3 right-3 rounded-lg bg-background/70 backdrop-blur-sm",
                  variant === "sheet" && "top-0 right-3 sm:top-3",
                )}
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Fechar diálogo</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Fechar
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-lg leading-snug font-bold",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
