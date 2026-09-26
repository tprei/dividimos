import { Github } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { landingContainer } from "./landing-section";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-bold whitespace-nowrap text-muted-foreground hover:text-foreground";

export function LandingFooter() {
  return (
    <footer className="border-t border-border pt-5.5 pb-7">
      <div
        className={cn(
          landingContainer,
          "flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center min-[481px]:justify-start min-[481px]:text-left",
        )}
      >
        <a href="#top" aria-label="Dividimos, início" className="inline-flex min-h-11 items-center">
          <Logo size="sm" />
        </a>
        <nav
          aria-label="Links"
          className="flex flex-wrap items-center justify-center gap-x-4.5 min-[481px]:ml-auto"
        >
          <Link href="/privacy" className={linkClass}>
            Privacidade
          </Link>
          <Link href="/terms" className={linkClass}>
            Termos
          </Link>
          <a href="https://github.com/tprei/dividimos" className={linkClass}>
            <Github className="size-3.5" aria-hidden="true" />
            GitHub
          </a>
        </nav>
        <p className="text-[13.5px] font-bold whitespace-nowrap text-muted-foreground">
          {BRAND.copyright}
        </p>
      </div>
    </footer>
  );
}
