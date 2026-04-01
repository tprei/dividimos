import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { JoinActions } from "./join-actions";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: link } = await admin
    .from("group_invite_links")
    .select("group_id, is_active, expires_at, max_uses, use_count, created_by")
    .eq("token", token)
    .single();

  if (!link) notFound();

  const [{ data: group }, { data: creator }] = await Promise.all([
    admin.from("groups").select("name").eq("id", link.group_id).single(),
    admin
      .from("user_profiles")
      .select("name, handle")
      .eq("id", link.created_by)
      .single(),
  ]);

  if (!group) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isExpired =
    link.expires_at != null && new Date(link.expires_at) < new Date();
  const isExhausted =
    link.max_uses != null && link.use_count >= link.max_uses;
  const isInvalid = !link.is_active || isExpired || isExhausted;

  const creatorName = creator?.name ?? "Alguém";

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
        <p className="mt-2 text-3xl font-bold">{group.name}</p>
        <div className="mt-3 flex gap-4 text-sm text-white/70">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            Convite de {creatorName}
            {creator?.handle ? ` (@${creator.handle})` : ""}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border bg-card p-5">
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-sm">
            Ao entrar, você poderá ver e criar despesas neste grupo.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Todos os membros podem dividir contas entre si.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <JoinActions
          token={token}
          isAuthenticated={!!user}
          isInvalid={isInvalid}
          isExpired={isExpired}
          isExhausted={isExhausted}
          isInactive={!link.is_active}
        />
      </div>
    </div>
  );
}
