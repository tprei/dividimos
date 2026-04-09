import { ActivityContent } from "@/components/activity/activity-content";
import { getAuthUser } from "@/lib/auth";
import { fetchActivityFeed } from "@/lib/supabase/activity-actions";

export default async function ActivityPage() {
  const user = await getAuthUser();

  if (!user) return null;

  const initialItems = await fetchActivityFeed({ userId: user.id, limit: 30 });

  return <ActivityContent initialItems={initialItems} userId={user.id} />;
}
