import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CTASection } from "@/components/landing/cta-section";
import { EmojiGrid } from "@/components/landing/emoji-grid";
import { HeroContent } from "@/components/landing/hero-content";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="flex h-dvh flex-col overflow-y-auto">
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo size="sm" animated />
          <Link href="/app">
            <Button size="sm">
              Abrir app
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="gradient-mesh absolute inset-0 -z-10" />
          <EmojiGrid />
          <div className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-32 sm:pt-24">
            <HeroContent />
          </div>
        </section>

        <section id="como-funciona">
          <HowItWorksSection />
        </section>

        <section className="py-20 sm:py-28" style={{ background: "linear-gradient(to bottom, transparent, oklch(0.78 0.16 75 / 8%) 40%, oklch(0.78 0.16 75 / 15%))" }}>
          <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
            <CTASection />
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-sm text-muted-foreground sm:px-6">
          <Logo size="sm" animated />
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacidade</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Termos</Link>
            <p>2026 Dividimos</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
