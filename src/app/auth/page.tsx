import { cookies } from "next/headers";
import { Suspense } from "react";
import { IntroCarousel } from "@/components/auth-intro/intro-carousel";
import { INTRO_SEEN_COOKIE, shouldPlayIntro } from "@/lib/auth-intro";

type AuthSearchParams = Promise<{ next?: string | string[]; error?: string | string[] }>;

/** Same answer as `URLSearchParams.get`, which is what the sign-in panel reads on the client. */
function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ?? null;
}

export default async function AuthPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const [{ next, error }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const playStory = shouldPlayIntro({
    seen: cookieStore.has(INTRO_SEEN_COOKIE),
    next: firstParam(next),
    error: firstParam(error),
  });

  return (
    <Suspense>
      <div className="intro-vp flex min-h-0 flex-1 flex-col">
        <IntroCarousel playStory={playStory} />
      </div>
    </Suspense>
  );
}
