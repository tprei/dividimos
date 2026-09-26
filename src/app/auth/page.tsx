import { Suspense } from "react";
import { AuthPanel } from "./auth-panel";

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPanel />
    </Suspense>
  );
}
