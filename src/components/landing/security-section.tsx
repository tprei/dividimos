import { AtSign, Code, EyeOff, Lock, Shield, type LucideIcon } from "lucide-react";
import { LandingSection, SectionHeading } from "./landing-section";

interface SecurityPoint {
  icon: LucideIcon;
  title: string;
  detail?: string;
}

const POINTS: SecurityPoint[] = [
  { icon: Lock, title: "Chave Pix criptografada", detail: "AES-256, sempre mascarada" },
  { icon: Shield, title: "O app nunca mexe no seu dinheiro", detail: "O Pix sai do seu banco" },
  { icon: EyeOff, title: "Ninguém te acha por busca", detail: "Só pelo @ exato" },
  { icon: AtSign, title: "Entra só com Google" },
  { icon: Code, title: "Código público no GitHub" },
];

export function SecuritySection() {
  return (
    <LandingSection id="seguranca">
      <SectionHeading eyebrow="Segurança" title="Seu Pix é seu." />
      <ul className="grid gap-3 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-6 min-[1100px]:gap-3.5">
        {POINTS.map(({ icon: Icon, title, detail }) => (
          <li
            key={title}
            className="flex items-center gap-3.5 rounded-lg border border-border bg-card p-4 min-[760px]:max-[1099px]:last:col-span-full min-[1100px]:col-span-2 min-[1100px]:nth-[n+4]:col-span-3"
          >
            <span className="grid size-10 flex-none place-items-center rounded-xl bg-primary/18 text-primary-text">
              <Icon aria-hidden="true" className="size-4.75" />
            </span>
            <div>
              <h3 className="text-[15.5px] leading-[1.3] font-black tracking-[-0.01em]">{title}</h3>
              {detail && <p className="mt-0.5 text-[13.5px] font-bold text-muted-foreground">{detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}
