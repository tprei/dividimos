"use client";

import { useParams } from "next/navigation";
import { ConversationPageClient } from "./conversation-page-client";

export function ConversationDetailPage() {
  const params = useParams<{ counterpartyId: string }>();
  return <ConversationPageClient counterpartyId={params.counterpartyId} />;
}
