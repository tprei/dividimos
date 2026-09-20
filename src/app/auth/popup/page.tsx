"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { completeGoogleRedirect } from "@/lib/capacitor/auth";
import { createClient } from "@/lib/supabase/client";

export default function AuthPopupPage() {
  const router = useRouter();

  useEffect(() => {
    const finish = async () => {
      try {
        const next = await completeGoogleRedirect(createClient());
        if (next === null) {
          router.replace("/auth?error=callback_failed");
          return;
        }
        router.replace(`/auth/continue?next=${encodeURIComponent(next)}`);
        router.refresh();
      } catch {
        router.replace("/auth?error=callback_failed");
      }
    };
    void finish();
  }, [router]);

  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
