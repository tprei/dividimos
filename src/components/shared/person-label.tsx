import { cn } from "@/lib/utils";

interface PersonLabelProps {
  name: string;
  /** Omitted or null for guests, who have no handle. */
  handle?: string | null;
  secondary?: string;
  overrideName?: string;
  className?: string;
  nameClassName?: string;
}

export function PersonLabel({
  name,
  handle,
  secondary,
  overrideName,
  className,
  nameClassName,
}: PersonLabelProps) {
  return (
    <span className={cn("flex min-w-0 flex-col items-start leading-tight", className)}>
      <span title={name} className={cn("block max-w-full truncate font-semibold", nameClassName)}>
        {overrideName ?? name}
      </span>
      {(secondary || handle) && (
        <span title={secondary || `@${handle}`} className="mt-1 block max-w-full truncate text-xs font-normal text-muted-foreground">
          {secondary || `@${handle}`}
        </span>
      )}
    </span>
  );
}
