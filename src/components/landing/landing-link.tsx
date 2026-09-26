"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRipple } from "./click-fx";
import styles from "./landing.module.css";

interface LandingLinkProps {
  href: string;
  size?: "md" | "lg";
  children: ReactNode;
}

export function LandingLink({ href, size = "md", children }: LandingLinkProps) {
  const { onPointerDown, ripples } = useRipple();
  return (
    <Link
      href={href}
      onPointerDown={onPointerDown}
      className={cn(styles.btn, styles.primary, size === "lg" && styles.lg)}
    >
      {children}
      {ripples}
    </Link>
  );
}
