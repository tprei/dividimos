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
