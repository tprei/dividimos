import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getAuthUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (user && !user.onboarded) {
    redirect("/auth/onboard");
  }

  return <AppShell initialUser={user}>{children}</AppShell>;
}
