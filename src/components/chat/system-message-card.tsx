"use client";

import {
  SystemExpenseCard,
  type SystemExpenseCardProps,
} from "./system-expense-card";
import {
  SystemSettlementCard,
  type SystemSettlementCardProps,
} from "./system-settlement-card";
import type { ChatMessageType } from "@/types";

export type SystemMessageData =
  | { type: "system_expense"; expense: SystemExpenseCardProps }
  | { type: "system_settlement"; settlement: SystemSettlementCardProps };

export interface SystemMessageCardProps {
  messageType: ChatMessageType;
  data: SystemMessageData;
}

export function SystemMessageCard({ data }: SystemMessageCardProps) {
  switch (data.type) {
    case "system_expense":
      return (
        <SystemExpenseCard
          expense={data.expense.expense}
          creator={data.expense.creator}
        />
      );
    case "system_settlement":
      return (
        <SystemSettlementCard
          settlement={data.settlement.settlement}
          fromUser={data.settlement.fromUser}
          toUser={data.settlement.toUser}
        />
      );
    default:
      return null;
  }
}
