import { getAuthUser } from "@/lib/auth";
import { ChargeHistoryList } from "@/components/dashboard/charge-history-list";
import { listVendorCharges } from "@/lib/supabase/vendor-charge-actions";

export default async function ChargesPage() {
  const user = await getAuthUser();

  if (!user) return null;

  const charges = await listVendorCharges(50);

  return <ChargeHistoryList initialCharges={charges} />;
}
