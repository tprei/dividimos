import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";
import { LandingLink } from "./landing-link";
import { LightSwitch } from "./light-switch";
import { landingContainer } from "./landing-section";
import styles from "./landing.module.css";

const NAV = [
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#pro-grupo", label: "Pro grupo" },
  { href: "#seguranca", label: "Segurança" },
  { href: "#duvidas", label: "Dúvidas" },
];

export function LandingHeader() {
  return (
    <header className={cn("sticky z-50 border-b border-border/70", styles.header)}>
      <a
        href="#main"
        className={cn(
          "absolute left-3 z-60 inline-flex min-h-11 items-center rounded-[10px] bg-primary px-4 text-sm font-extrabold text-primary-foreground",
          styles.skipLink,
        )}
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
        <div className="flex items-center gap-1.5">
          <LightSwitch />
          <LandingLink href="/app">Abrir app</LandingLink>
        </div>
      </div>
    </header>
  );
}
