import { PersonDetailPage } from "./person-detail-page";

export function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

export default function Page() {
  return <PersonDetailPage />;
}
