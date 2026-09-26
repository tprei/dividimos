import { FxProvider } from "@/components/landing/click-fx";
import { CTASection } from "@/components/landing/cta-section";
import { GroupSection } from "@/components/landing/group-section";
import { GuestSection } from "@/components/landing/guest-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { cn } from "@/lib/utils";
import styles from "@/components/landing/landing.module.css";

export default function LandingPage() {
  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-x-hidden overflow-y-auto motion-safe:scroll-smooth",
        styles.page,
      )}
    >
      <FxProvider>
        <LandingHeader />
        <main id="main" className="flex-1">
          <Hero />
          <HowItWorksSection />
          <GuestSection />
          <GroupSection />
          <section
            className="py-20 sm:py-28"
            style={{ background: "linear-gradient(to bottom, transparent, oklch(0.78 0.16 75 / 8%) 40%, oklch(0.78 0.16 75 / 15%))" }}
          >
            <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
              <CTASection />
            </div>
          </section>
        </main>
        <LandingFooter />
      </FxProvider>
    </div>
  );
}
