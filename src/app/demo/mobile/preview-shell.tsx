"use client";

import type { ReactNode } from "react";
import { NavBar } from "@/components/app-shell";
import { cn } from "@/lib/utils";

export type NavTab = "home" | "conversations" | "groups" | "profile";

const NAV_PATHS: Record<NavTab, string> = {
  home: "/app",
  conversations: "/app/conversations",
  groups: "/app/groups",
  profile: "/app/profile",
};

const PREVIEW_DESTINATIONS: Record<string, string> = {
  "/app": "/demo/mobile/home",
  "/app/conversations": "/demo/mobile/conversations",
  "/app/bill/new": "/demo/mobile/bill-single",
  "/app/groups": "/demo/mobile/groups",
  "/app/profile": "/demo/mobile/profile",
};

function previewHref(href: string): string {
  const destination = PREVIEW_DESTINATIONS[href];
  if (!destination) throw new Error(`Unknown preview navigation destination: ${href}`);
  return destination;
}

export function PreviewShell({
  nav,
  children,
}: {
  nav: NavTab | null;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <main className={cn("flex-1 overflow-y-auto scroll-pb-24", nav !== null && "pb-24")}>
        {children}
      </main>
      {nav !== null && <NavBar pathname={NAV_PATHS[nav]} resolveHref={previewHref} />}
    </div>
  );
}
