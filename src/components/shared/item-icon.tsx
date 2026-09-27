import Image from "next/image";
import { isItemIcon } from "@/lib/item-icons";
import { cn } from "@/lib/utils";

interface ItemIconProps {
  icon?: string;
  size?: "sm" | "md";
  className?: string;
}

const sizeClasses = { sm: "size-5", md: "size-6" };
const sizePx = { sm: 20, md: 24 };

export function ItemIcon({ icon, size = "md", className }: ItemIconProps) {
  const classes = cn("shrink-0", sizeClasses[size], className);
  if (!isItemIcon(icon)) return <span aria-hidden="true" className={classes} />;

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
