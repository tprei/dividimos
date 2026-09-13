import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { resolveAuthProfile } from "@/lib/auth";
import { safeRedirect } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

type ContinueSearchParams = Promise<{ next?: string | string[] }>;

function authRedirect(destination: string): never {
  redirect(`/auth?next=${encodeURIComponent(destination)}`);
}

function retryPage(destination: string) {
  const retryUrl = `/auth/continue?next=${encodeURIComponent(destination)}`;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6">
      <section className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold">Não conseguimos carregar sua conta</h1>
        <p className="text-sm text-muted-foreground">
          Tente novamente para continuar.
        </p>
        <a className="text-sm font-medium text-primary underline" href={retryUrl}>
          Tentar novamente
        </a>
      </section>
    </main>
  );
}

export default async function ContinuePage({
  searchParams,
}: {
  searchParams: ContinueSearchParams;
}) {
  const { next } = await searchParams;
  const destination = safeRedirect(typeof next === "string" ? next : undefined);

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return retryPage(destination);
  }

  let userResult;
  try {
    userResult = await supabase.auth.getUser();
  } catch (error) {
    if (isAuthSessionMissingError(error)) authRedirect(destination);
    return retryPage(destination);
  }
  if (userResult.error != null) {
    if (isAuthSessionMissingError(userResult.error)) authRedirect(destination);
    return retryPage(destination);
  }
  if (userResult.data.user == null) authRedirect(destination);

  const profile = await resolveAuthProfile();
  if (profile.kind === "unauthenticated") authRedirect(destination);
  if (profile.kind !== "ok") return retryPage(destination);
  if (profile.me.id !== userResult.data.user.id) return retryPage(destination);

  if (profile.me.onboarded) redirect(destination);
  redirect(`/auth/onboard?next=${encodeURIComponent(destination)}`);
}
