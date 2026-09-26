import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";
import { LandingLink } from "./landing-link";
import { landingContainer } from "./landing-section";

const NAV = [
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#pro-grupo", label: "Pro grupo" },
  { href: "#seguranca", label: "Segurança" },
  { href: "#duvidas", label: "Dúvidas" },
];

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-surface/80 backdrop-blur-xl backdrop-saturate-180">
      <a
        href="#main"
        className="absolute top-[-60px] left-3 z-60 inline-flex min-h-11 items-center rounded-[10px] bg-primary px-4 text-sm font-extrabold text-primary-foreground focus:top-2.5"
      >
        Pular para o conteúdo
      </a>
      <div className={cn(landingContainer, "flex min-h-15 items-center justify-between gap-4")}>
        <a href="#top" aria-label="Dividimos, início" className="inline-flex min-h-11 items-center">
          <Logo size="sm" />
        </a>
        <nav aria-label="Seções" className="hidden gap-1 min-[920px]:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-[10px] px-3.5 text-sm font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <LandingLink href="/app">Abrir app</LandingLink>
      </div>
    </header>
  );
}
