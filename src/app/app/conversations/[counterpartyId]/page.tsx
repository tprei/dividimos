import { ConversationDetailPage } from "./conversation-detail-page";

export function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

export default function ConversationPage() {
  return <ConversationDetailPage />;
}
