import Link from "next/link";
import { notFound } from "next/navigation";
import { UserCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { UserAvatar } from "@/components/shared/user-avatar";
import { buttonVariants } from "@/components/ui/button";
import { SendMessageButton } from "./profile-actions";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const normalizedHandle = handle.toLowerCase().trim();

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, handle, name, avatar_url")
    .eq("handle", normalizedHandle)
    .single();

  if (!profile) notFound();

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const isSelf = authUser?.id === profile.id;

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="rounded-full bg-card p-1 shadow-lg">
            <UserAvatar
              name={profile.name}
              avatarUrl={profile.avatar_url}
              size="lg"
              className="h-24 w-24 text-2xl"
            />
          </div>

          <h1 className="mt-4 text-2xl font-bold">{profile.name}</h1>
          <p className="text-muted-foreground">@{profile.handle}</p>
        </div>

        <div className="rounded-2xl border bg-card p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <UserCircle className="h-4 w-4" />
            <span>Perfil no Dividimos</span>
          </div>
        </div>

        {!authUser && (
          <div className="space-y-3">
            <Link
              href={`/auth?next=${encodeURIComponent(`/u/${profile.handle}`)}`}
              className={buttonVariants({ size: "lg", className: "w-full" })}
            >
              Criar conta
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              Crie sua conta para dividir contas com {profile.name}
            </p>
          </div>
        )}

        {authUser && !isSelf && (
          <SendMessageButton
            targetUserId={profile.id}
            targetName={profile.name}
          />
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
