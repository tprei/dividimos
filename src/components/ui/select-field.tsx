"use client";

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectFieldProps {
  label?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  hideLabel?: boolean
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  id,
  placeholder,
  disabled,
  hideLabel,
}: SelectFieldProps) {
  const fallbackId = React.useId()
  const triggerId = id ?? fallbackId

  return (
    <SelectPrimitive.Root
      items={options.map(({ value, label }) => ({ value, label }))}
      value={value}
      onValueChange={(nextValue) => onChange(nextValue ?? "")}
      disabled={disabled}
    >
      {label && !hideLabel ? <Label htmlFor={triggerId}>{label}</Label> : null}
      <SelectPrimitive.Trigger
        id={triggerId}
        aria-label={hideLabel ? label : undefined}
        data-slot="select-field-trigger"
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-open:border-ring data-open:ring-3 data-open:ring-ring/50"
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          data-slot="select-field-value"
          className="min-w-0 flex-1 truncate text-left"
        />
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          sideOffset={4}
          className="isolate z-50 outline-none"
        >
          <SelectPrimitive.Popup
            data-slot="select-field-popup"
            className={cn(
              "z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95"
            )}
          >
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                data-slot="select-field-item"
                className={cn(
                  "relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-sm outline-none data-highlighted:bg-primary data-highlighted:text-primary-foreground data-selected:bg-primary data-selected:text-primary-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                )}
              >
                <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="flex shrink-0">
                  <CheckIcon className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
