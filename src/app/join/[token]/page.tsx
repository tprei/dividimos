import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { JoinActions } from "./join-actions";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { INVALID_INVITE_MESSAGE, parseInvitePreview } from "./invite-preview";
import { initialsOf } from "@/lib/people";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: previewData, error: previewError } = await supabase.rpc("preview_invite_link", {
    p_token: token,
  });

  if (previewError) {
    throw new Error(`preview_invite_link failed: ${previewError.message}`);
  }

  const preview = parseInvitePreview(previewData);
  const isInvalid = preview === null || !preview.valid || !preview.groupName;

  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claimsData?.claims?.sub);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <Link href="/" aria-label="Voltar ao início" className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "mb-6")}>
        <ArrowLeft className="size-5" />
      </Link>
      <section className="rounded-2xl border border-border bg-card p-6">
        {isInvalid ? (
          <div role="alert" className="text-center">
            <h1 className="text-2xl font-bold">{INVALID_INVITE_MESSAGE}</h1>
            <p className="mt-2 text-base text-muted-foreground">Peça um novo link a quem convidou você.</p>
            <Link href={isAuthenticated ? "/app" : "/auth"} className={cn(buttonVariants(), "mt-6 w-full")}>
              {isAuthenticated ? "Ir para o início" : "Entrar no Dividimos"}
            </Link>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col items-center text-center">
            <div aria-hidden="true" className="flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/15 text-2xl font-bold text-primary-text">{initialsOf(preview.groupName ?? "")}</div>
            <p className="mt-4 text-sm text-muted-foreground">Convite para o grupo</p>
            <h1 className="mt-2 max-w-full break-words text-2xl font-bold">{preview.groupName}</h1>
            <p className="mt-2 max-w-full break-words text-base text-muted-foreground">
              Convite de {preview.creatorName ?? "um amigo"}
            </p>
            <div className="mt-6 w-full">
              <JoinActions token={token} isAuthenticated={isAuthenticated} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
