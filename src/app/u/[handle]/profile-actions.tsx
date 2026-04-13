"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getOrCreateDmGroup } from "@/lib/supabase/dm-actions";
import toast from "react-hot-toast";

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
    const result = await getOrCreateDmGroup(targetUserId);

    if ("error" in result) {
      toast.error(result.error);
      setLoading(false);
      return;
    }

    router.push(`/app/conversations/${targetUserId}`);
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
