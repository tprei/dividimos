import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRedirect } from "@/lib/safe-redirect";
import { UserProvider } from "@/contexts/user-context";
import { completeOnboarding } from "./actions";
import { OnboardForm, type OnboardingDraftSeed } from "./onboard-form";

type OnboardPageProps = Readonly<{
  searchParams: Promise<{ next?: string | string[] }>;
}>;

export default async function OnboardPage({ searchParams }: OnboardPageProps) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : null;
  const redirectTo = safeRedirect(rawNext);

  const supabase = await createClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) {
    redirect(`/auth?next=${encodeURIComponent(redirectTo)}`);
  }

  const projected = await getAuthUser();
  if (!projected || projected.id !== authUser.id) {
    // Sanitized: no Supabase error, no synthesized User, no insert/upsert.
    throw new Error("Perfil indisponível.");
  }

  if (projected.onboarded) {
    redirect(redirectTo);
  }

  const expectedUserId = authUser.id;
  const seed: OnboardingDraftSeed = {
    sourceUserId: projected.id,
    email: projected.email ?? "",
    name: projected.name ?? "",
    handle: projected.handle ?? "",
  };

  async function action(formData: FormData) {
    "use server";
    return completeOnboarding(expectedUserId, redirectTo, formData);
  }

  return (
    <UserProvider initialUser={projected}>
      <OnboardForm seed={seed} action={action} />
    </UserProvider>
  );
}
