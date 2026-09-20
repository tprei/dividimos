"use client";

import { useParams } from "next/navigation";
import { GroupInfoContent } from "@/components/group/group-info-content";

export function GroupInfoPage() {
  const params = useParams<{ id: string }>();
  return <GroupInfoContent groupId={params.id} />;
}
