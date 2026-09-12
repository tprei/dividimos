"use client";

import { MessageCircle, Split } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { getOrCreateDm } from "@/lib/sync/mutations-group";
import { useStartBillWithUser } from "@/components/profile/use-start-bill-with-user";

interface SendMessageButtonProps {
  targetUserId: string;
  targetName: string;
}

export function SendMessageButton({
  targetUserId,
  targetName,
}: SendMessageButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSendMessage = async () => {
    setLoading(true);
    try {
      await getOrCreateDm(targetUserId);
      router.push(`/app/conversations/${targetUserId}`);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleSendMessage}
      disabled={loading}
      className="w-full gap-2"
      size="lg"
    >
      <MessageCircle className="h-5 w-5" />
      {loading ? "Abrindo conversa..." : `Enviar mensagem para ${targetName}`}
    </Button>
  );
}

export function SplitBillButton({
  targetUserId,
  targetName,
}: SendMessageButtonProps) {
  const { startBill, starting } = useStartBillWithUser();

  return (
    <Button
      onClick={() => void startBill(targetUserId)}
      disabled={starting}
      className="w-full gap-2"
      size="lg"
    >
      <Split className="h-5 w-5" />
      {starting ? "Abrindo conta..." : `Dividir uma conta com ${targetName}`}
    </Button>
  );
}
