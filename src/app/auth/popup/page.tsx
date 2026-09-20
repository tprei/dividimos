"use client";

import { SocialLogin } from "@capgo/capacitor-social-login";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

export default function AuthPopupPage() {
  useEffect(() => {
    SocialLogin.handleRedirectCallback().catch(() => window.close());
  }, []);

  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
