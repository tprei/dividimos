"use client";

import { createContext, useContext } from "react";

/**
 * The shell-level header action (unified Bell + NotificationsSheet opener)
 * provided to every ScreenHeader so activity and invitations have one
 * navigation entry on all authenticated routes.
 */
export const ScreenHeaderActionsContext = createContext<React.ReactNode>(null);

export function useScreenHeaderActions(): React.ReactNode {
  return useContext(ScreenHeaderActionsContext);
}
