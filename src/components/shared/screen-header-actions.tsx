"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The shell-level header action (unified Bell + NotificationsSheet opener)
 * provided to every ScreenHeader so activity and invitations have one
 * navigation entry on all authenticated routes.
 */
export const ScreenHeaderActionsContext = createContext<ReactNode>(null);

export function useScreenHeaderActions(): ReactNode {
  return useContext(ScreenHeaderActionsContext);
}

export interface ScreenRefresh {
  refreshing: boolean;
  refresh: () => void;
}

/**
 * The shell's one refresh, shared by the pull gesture and any header button
 * so both run the same sync and never overlap.
 */
export const ScreenRefreshContext = createContext<ScreenRefresh | null>(null);

export function useScreenRefresh(): ScreenRefresh | null {
  return useContext(ScreenRefreshContext);
}
