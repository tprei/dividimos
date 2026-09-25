"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { completeGoogleRedirect } from "@/lib/capacitor/auth";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/shared/logo";

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
    <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-8">
      <Logo size="md" />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-5 animate-spin" /> Entrando…
      </p>
    </div>
  );
}
