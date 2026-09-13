import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|icons|sw.js|manifest.webmanifest|offline.html|icon-192.png|icon-512.png|badge-72.png).*)",
  ],
};
