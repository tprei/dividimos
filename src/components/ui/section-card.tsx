import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function SectionCard({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="section-card" className={cn("overflow-hidden rounded-2xl border border-border bg-card text-card-foreground [&>[data-slot=list-row]+[data-slot=list-row]]:border-t [&>[data-slot=list-row]]:border-border", className)} />;
}
