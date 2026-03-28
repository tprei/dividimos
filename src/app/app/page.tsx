import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { getAuthUser } from "@/lib/auth";
import { fetchUserDebts } from "@/lib/supabase/debt-actions";
import { createClient } from "@/lib/supabase/server";

export default async function AppHome() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const [debts, balancesResult] = await Promise.all([
    fetchUserDebts(user.id),
    supabase
      .from("balances")
      .select("user_a, user_b, amount_cents")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`),
  ]);

  let netBalance = 0;
  for (const row of balancesResult.data ?? []) {
    if (row.user_a === user.id) {
      netBalance -= row.amount_cents;
    } else {
      netBalance += row.amount_cents;
    }
  }

  return <DashboardContent initialDebts={debts} initialNetBalance={netBalance} />;
}
