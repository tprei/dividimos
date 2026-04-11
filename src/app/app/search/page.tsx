import { SearchContent } from "@/components/search/search-content";
import { getAuthUser } from "@/lib/auth";

export default async function SearchPage() {
  const user = await getAuthUser();

  if (!user) return null;

  return <SearchContent userId={user.id} />;
}
