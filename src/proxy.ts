import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|images|icons|item-icons/|screenshots/|sw.js|manifest.webmanifest|offline.html|opengraph-image|[^/]+\\.(?:svg|png|ico|jpg|jpeg|webp)$).*)",
  ],
};
