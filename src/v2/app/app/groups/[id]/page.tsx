"use client";

import { useParams } from "next/navigation";
import { GroupDetailContent } from "@/components/group/group-detail-content";

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  return <GroupDetailContent groupId={params.id} />;
}
