import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";

export function GuestAvatar({
  id,
  name,
  size = "md",
  className,
  standalone,
}: {
  id: string;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  standalone?: boolean;
}) {
  return <UserAvatar id={id} name={name} size={size} standalone={standalone} className={cn("border border-dashed border-current", className)} />;
}
