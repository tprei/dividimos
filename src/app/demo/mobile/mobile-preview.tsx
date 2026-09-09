"use client";

import type { ComponentType } from "react";
import type { ScreenName } from "./screen-names";
import { BillCreatedScreen } from "./screens/bill-created";
import { BillItemizedScreen } from "./screens/bill-itemized";
import { BillSingleScreen } from "./screens/bill-single";
import { ChatScreen } from "./screens/chat";
import { ConversationsScreen } from "./screens/conversations";
import { GroupsScreen } from "./screens/groups";
import { HomeScreen } from "./screens/home";
import { ProfileScreen } from "./screens/profile";
import { ReceiptScreen } from "./screens/receipt";
import { SettlementScreen } from "./screens/settlement";

export interface ScreenProps {
  sheet: string | null;
  section: string | null;
}

const SCREENS: Record<ScreenName, ComponentType<ScreenProps>> = {
  home: HomeScreen,
  conversations: ConversationsScreen,
  chat: ChatScreen,
  groups: GroupsScreen,
  "bill-single": BillSingleScreen,
  "bill-itemized": BillItemizedScreen,
  receipt: ReceiptScreen,
  settlement: SettlementScreen,
  profile: ProfileScreen,
  "bill-created": BillCreatedScreen,
};

export function MobilePreview({
  screen,
  sheet,
  section,
}: ScreenProps & { screen: ScreenName }) {
  const Screen = SCREENS[screen];
  return <Screen sheet={sheet} section={section} />;
}
