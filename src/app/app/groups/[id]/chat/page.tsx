import { GroupChatPage } from "./group-chat-client";

export function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

export default function Page() {
  return <GroupChatPage />;
}
