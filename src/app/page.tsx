import { BrazilSection } from "@/components/landing/brazil-section";
import { FxProvider } from "@/components/landing/click-fx";
import { FaqSection } from "@/components/landing/faq-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { GroupSection } from "@/components/landing/group-section";
import { GuestSection } from "@/components/landing/guest-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { SecuritySection } from "@/components/landing/security-section";
import { WaysSection } from "@/components/landing/ways-section";
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
          <WaysSection />
          <BrazilSection />
          <SecuritySection />
          <FaqSection />
          <FinalCtaSection />
        </main>
        <LandingFooter />
      </FxProvider>
    </div>
  );
}
