import Image from "next/image";
import { cn } from "@/lib/utils";
import type { ItemIcon as ItemIconKey } from "@/types";

interface ItemIconProps {
  icon?: ItemIconKey;
  size?: "sm" | "md";
  className?: string;
}

const sizeClasses = { sm: "size-5", md: "size-6" };
const sizePx = { sm: 20, md: 24 };

export function ItemIcon({ icon, size = "md", className }: ItemIconProps) {
  const classes = cn("shrink-0", sizeClasses[size], className);
  if (!icon) return <span aria-hidden="true" className={classes} />;

  return (
    <Image
      src={`/item-icons/${icon}.svg`}
      alt=""
      aria-hidden="true"
      width={sizePx[size]}
      height={sizePx[size]}
      unoptimized
      className={classes}
    />
  );
}
