import { ArrowLeft, Check, Receipt } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/currency";
import { ClaimActions } from "./claim-actions";

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: guest } = await admin
    .from("expense_guests")
    .select("*")
    .eq("claim_token", token)
    .single();

  if (!guest) notFound();

  const [{ data: expense }, { data: guestShare }] = await Promise.all([
    admin
      .from("expenses")
      .select("id, title, merchant_name, total_amount, status, creator_id, group_id")
      .eq("id", guest.expense_id)
      .single(),
    admin
      .from("expense_guest_shares")
      .select("share_amount_cents")
      .eq("guest_id", guest.id)
      .single(),
  ]);

  if (!expense) notFound();

  const { data: creator } = await admin
    .from("user_profiles")
    .select("name, handle")
    .eq("id", expense.creator_id)
    .single();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const alreadyClaimed = !!guest.claimed_by;
  const shareAmount = guestShare?.share_amount_cents ?? 0;
  const creatorName = creator?.name ?? "Alguém";

  if (alreadyClaimed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-success/30 bg-success/5 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
            <Check className="h-6 w-6 text-success" />
          </div>
          <h1 className="mt-4 text-lg font-bold">Já tá confirmado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este convite já foi aceito.
          </p>
          <Link
            href={`/app/bill/${expense.id}`}
            className="mt-4 text-sm font-medium text-primary hover:underline"
          >
            Ver despesa
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-semibold">Confirmar participação</h1>
      </div>

      <div className="mt-6 rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
        <p className="text-sm text-white/70">{expense.title}</p>
        {expense.merchant_name && (
          <p className="text-xs text-white/60 mt-0.5">{expense.merchant_name}</p>
        )}
        <p className="mt-2 text-3xl font-bold tabular-nums">
          {formatBRL(shareAmount)}
        </p>
        <p className="mt-1 text-sm text-white/70">
          Sua parte na conta
        </p>
        <div className="mt-3 flex gap-4 text-sm text-white/70">
          <span className="flex items-center gap-1">
            <Receipt className="h-3.5 w-3.5" />
            Total: {formatBRL(expense.total_amount)}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {creatorName.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-medium">{creatorName}</p>
            <p className="text-xs text-muted-foreground">
              {creator?.handle ? `@${creator.handle}` : ""} criou esta conta
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-muted/50 p-3">
          <p className="text-sm">
            <span className="font-medium">{guest.display_name}</span>, você foi
            convidado(a) pra participar desta conta.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ao confirmar, você entra no grupo e sua parte fica registrada.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <ClaimActions
          token={token}
          expenseId={expense.id}
          isAuthenticated={!!user}
          expenseStatus={expense.status}
        />
      </div>
    </div>
  );
}
