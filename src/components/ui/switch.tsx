"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"
import { haptics } from "@/hooks/use-haptics"

function Switch({
  className,
  size = "default",
  onCheckedChange,
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      onCheckedChange={(checked, details) => {
        haptics.selectionChanged();
        onCheckedChange?.(checked, details);
      }}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-input transition-colors outline-none after:absolute after:left-1/2 after:top-1/2 after:h-11 after:min-w-11 after:w-full after:-translate-x-1/2 after:-translate-y-1/2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive data-[size=default]:h-6 data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-checked:bg-primary data-unchecked:bg-muted data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-foreground ring-0 motion-safe:transition-transform group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 data-checked:translate-x-full data-unchecked:translate-x-0 data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
