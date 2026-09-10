import { User } from "lucide-react";
import { cn } from "@/lib/utils";

const AVATAR_SIZES = { xs: "size-6", sm: "size-8", md: "size-10" };

export function GuestAvatar({
  size = "md",
  className,
}: {
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground",
        AVATAR_SIZES[size],
        className,
      )}
    >
      <User className={size === "md" ? "size-4" : "size-3.5"} />
    </div>
  );
}

export function GuestBadge() {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      Convidado
    </span>
  );
}
