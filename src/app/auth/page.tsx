import { Suspense } from "react";
import { LoginSlide } from "@/components/auth-intro/login-slide";

export default function AuthPage() {
  return (
    <Suspense>
      <div className="intro-vp flex min-h-0 flex-1 flex-col">
        <LoginSlide stage="play" />
      </div>
    </Suspense>
  );
}
