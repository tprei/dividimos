import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Round check shown on toggleable rows; amber only when selected. */
export function SelectionMark({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
        selected ? "bg-primary text-primary-foreground" : "border-2 border-muted-foreground/35",
        className,
      )}
    >
      {selected && <Check className="size-3" />}
    </span>
  );
}
