import { ExpenseDetailPage } from "./expense-detail-page";

export function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

export default function Page() {
  return <ExpenseDetailPage />;
}
