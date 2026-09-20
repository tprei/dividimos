import { GroupInfoPage } from "./group-info-page";

export function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

export default function Page() {
  return <GroupInfoPage />;
}
