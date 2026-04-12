export async function notifyChatMessage(params: {
  recipientUserId: string;
  senderName: string;
  messagePreview: string;
  conversationGroupId: string;
}): Promise<void> {
  fetch("/api/chat/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).catch(() => {});
}
