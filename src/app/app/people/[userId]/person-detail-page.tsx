"use client";

import { motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { PersonProfile } from "@/components/person/person-profile";
import { useStartBillWithUser } from "@/components/profile/use-start-bill-with-user";
import { useAppStore } from "@/stores/app-store";

export function PersonDetailPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const me = useAppStore((s) => s.me);
  const { openConversation, starting } = useStartBillWithUser();
  const userId = params.userId;

  useEffect(() => {
    if (me !== null && me.id === userId) router.replace("/app/profile");
  }, [me, userId, router]);

  const isSelf = me !== null && me.id === userId;

  return (
    <motion.div initial="hidden" animate="visible">
      {isSelf ? null : (
        <PersonProfile
          userId={userId}
          onBack={() => router.back()}
          onMessage={() => void openConversation(userId)}
          messagePending={starting}
        />
      )}
    </motion.div>
  );
}
