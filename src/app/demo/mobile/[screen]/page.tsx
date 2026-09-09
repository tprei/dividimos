import { notFound } from "next/navigation";
import { MobilePreview } from "../mobile-preview";
import { isScreenName } from "../screen-names";

export default async function MobilePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ sheet?: string | string[]; section?: string | string[] }>;
}) {
  const { screen } = await params;
  const { sheet, section } = await searchParams;
  if (process.env.NODE_ENV === "production" || !isScreenName(screen)) {
    notFound();
  }
  return (
    <MobilePreview
      screen={screen}
      sheet={typeof sheet === "string" ? sheet : null}
      section={typeof section === "string" ? section : null}
    />
  );
}
