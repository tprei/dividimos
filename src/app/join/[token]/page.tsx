import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JoinActions } from "./join-actions";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: previewData } = await supabase.rpc("preview_invite_link", {
    p_token: token,
  });

  const preview = previewData as {
    groupName: string | null;
    memberCount: number | null;
    creatorName: string | null;
    valid: boolean;
  } | null;

  // The RPC failed to return anything at all; only then is this a 404.
  if (!preview) notFound();

  const isInvalid = !preview.valid || !preview.groupName;

  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claimsData?.claims?.sub);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-semibold">Entrar no grupo</h1>
      </div>

      <div className="mt-6 rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
        <p className="text-sm text-white/70">Convite para o grupo</p>
        <p className="mt-2 text-3xl font-bold">
          {isInvalid ? "Convite indisponível" : preview.groupName}
        </p>
        {!isInvalid && (
          <div className="mt-3 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              Convite de {preview.creatorName ?? "Alguém"}
            </span>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-2xl border bg-card p-5">
        {!isInvalid && (
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-sm">
              Ao entrar, você poderá ver e criar despesas neste grupo.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Todos os membros podem dividir contas entre si.
            </p>
          </div>
        )}
      </div>
      <div className="mt-5">
        <JoinActions token={token} isAuthenticated={isAuthenticated} isInvalid={isInvalid} />
      </div>
    </div>
  );
}
