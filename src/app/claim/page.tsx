import type { Metadata } from "next";
import { ClaimPageClient } from "./claim-page-client";

// Token-blind: the credential lives only in the URL fragment, which never
// reaches the server. This route performs no DB lookup and renders no guest,
// expense, or token data. `force-dynamic` keeps it out of the static cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Convite — Dividimos",
  description: "Confirme sua participação em uma conta.",
};

export default function ClaimPage() {
  return <ClaimPageClient />;
}
