import { createClient } from "@/lib/supabase/client";

/**
 * Delete a draft bill from Supabase.
 *
 * The RLS policy restricts deletion to the bill creator and only when
 * status is 'draft'. Cascade FK constraints clean up child rows
 * (participants, items, splits, payers, ledger) automatically.
 */
export async function deleteDraftFromSupabase(
  billId: string,
): Promise<{ error?: string }> {
  const supabase = createClient();

  const { error } = await supabase
    .from("bills")
    .delete()
    .eq("id", billId)
    .eq("status", "draft");

  if (error) {
    console.error("Failed to delete draft:", error);
    return { error: error.message };
  }

  return {};
}
