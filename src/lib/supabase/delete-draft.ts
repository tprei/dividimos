import { createClient } from "./client";

/**
 * Delete a draft bill. RLS ensures only the creator can delete,
 * and only while status = 'draft'. Child rows cascade automatically.
 */
export async function deleteDraftFromSupabase(
  billId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = createClient();

  const { error } = await supabase
    .from("bills")
    .delete()
    .eq("id", billId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
