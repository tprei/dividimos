import Link from "next/link";
import { notFound } from "next/navigation";
import { UserCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { lookupProfile } from "@/lib/profile-lookup";
import { AppError } from "@/lib/errors";
import { UserAvatar } from "@/components/shared/user-avatar";
import { buttonVariants } from "@/components/ui/button-variants";
import { SendMessageButton, SplitBillButton } from "./profile-actions";
import type { UserProfile } from "@/types/ledger";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const normalizedHandle = handle.toLowerCase().trim();

  let profile: UserProfile | null = null;
  let anonymous = false;
  let unavailable = false;
  try {
    profile = await lookupProfile(normalizedHandle);
  } catch (error) {
    if (error instanceof AppError && error.code === "AUTH_UNAUTHORIZED") {
      anonymous = true;
    } else if (error instanceof AppError && error.code === "USER_INVALID_HANDLE") {
      notFound();
    } else {
      unavailable = true;
    }
  }

  if (unavailable) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="rounded-full bg-card p-1 shadow-lg w-fit mx-auto">
            <UserAvatar
              name={normalizedHandle}
              avatarUrl={null}
              size="lg"
              className="h-24 w-24 text-2xl"
            />
          </div>
          <h1 className="text-xl font-semibold">@{normalizedHandle}</h1>
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <UserCircle className="h-4 w-4" />
              <span>Perfil temporariamente indisponível. Tente de novo em instantes.</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (anonymous) {
    // The lookup boundary is authenticated-only, so a signed-out visitor
    // cannot read the profile; the CTA branch stays present and renders
    // from the handle in the URL.
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-card p-1 shadow-lg">
              <UserAvatar
                name={normalizedHandle}
                avatarUrl={null}
                size="lg"
                className="h-24 w-24 text-2xl"
              />
            </div>
            <h1 className="mt-4 text-2xl font-bold">@{normalizedHandle}</h1>
            <p className="text-muted-foreground">@{normalizedHandle}</p>
          </div>

          <div className="rounded-2xl border bg-card p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <UserCircle className="h-4 w-4" />
              <span>Perfil no Dividimos</span>
            </div>
          </div>

          <div className="space-y-3">
            <Link
              href={`/auth?next=${encodeURIComponent(`/u/${normalizedHandle}`)}`}
              className={buttonVariants({ size: "lg", className: "w-full" })}
            >
              Criar conta
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              Crie sua conta para dividir contas com @{normalizedHandle}
            </p>
          </div>
        </div>
      </div>
    );
  }


  if (!profile) notFound();

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const callerId = claimsData?.claims?.sub ?? null;

  const isSelf = callerId === profile.id;
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="rounded-full bg-card p-1 shadow-lg">
            <UserAvatar
              name={profile.name || normalizedHandle}
              avatarUrl={profile.avatarUrl ?? null}
              size="lg"
              className="h-24 w-24 text-2xl"
            />
          </div>

          <h1 className="mt-4 text-2xl font-bold">{profile.name || `@${profile.handle}`}</h1>
          <p className="text-muted-foreground">@{profile.handle}</p>
        </div>

        <div className="rounded-2xl border bg-card p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <UserCircle className="h-4 w-4" />
            <span>Perfil no Dividimos</span>
          </div>
        </div>

        {!callerId && (
          <div className="space-y-3">
            <Link
              href={`/auth?next=${encodeURIComponent(`/u/${profile.handle}`)}`}
              className={buttonVariants({ size: "lg", className: "w-full" })}
            >
              Criar conta
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              Crie sua conta para dividir contas com {profile.name || `@${profile.handle}`}
            </p>
          </div>
        )}

        {callerId && !isSelf && (
          <>
            <SplitBillButton targetUserId={profile.id} targetName={profile.name} />
            <SendMessageButton targetUserId={profile.id} targetName={profile.name} />
          </>
        )}

        {isSelf && (
          <Link
            href="/app/profile"
            className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}
          >
            Ir para meu perfil
          </Link>
        )}
      </div>
    </div>
  );
}
