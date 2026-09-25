"use client";

import type { ComponentProps } from "react";
import { Button } from "./button";

export type IconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "aria-label"> & {
  "aria-label": string;
  size?: "icon-sm" | "icon" | "icon-lg";
};

export function IconButton({ size = "icon", variant = "ghost", ...props }: IconButtonProps) {
  return <Button size={size} variant={variant} {...props} />;
}
