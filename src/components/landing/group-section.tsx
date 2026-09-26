import { Check } from "lucide-react";
import { LandingSection, SectionHeading } from "./landing-section";
import { PhoneFrame, soloPhoneClass } from "./phone-frame";

const FEATURES = [
  "Saldo sempre em dia",
  "Menos Pix pra acertar",
  "Mais de um pagador",
  "Igual, % ou valor",
  "10% e couvert",
];

export function GroupSection() {
  return (
    <LandingSection id="pro-grupo">
      <div className="grid gap-8.5 min-[960px]:grid-cols-[minmax(0,1fr)_auto] min-[960px]:items-center min-[960px]:gap-16">
        <div>
          <SectionHeading eyebrow="Pro grupo" title="Pro grupo que racha sempre." />
          <ul className="flex flex-wrap gap-2.5 min-[960px]:flex-col min-[960px]:items-start min-[960px]:gap-3">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="inline-flex min-h-11 items-center gap-2.25 rounded-full border border-border bg-card py-2 pr-4 pl-2.5 text-[15px] font-extrabold min-[960px]:min-h-13 min-[960px]:py-2.5 min-[960px]:pr-5 min-[960px]:pl-3 min-[960px]:text-[17px]"
              >
                <Check
                  aria-hidden="true"
                  strokeWidth={3}
                  className="size-5.5 flex-none rounded-full bg-success/20 p-1.25 text-success-text min-[960px]:size-6.5"
                />
                {feature}
              </li>
            ))}
          </ul>
        </div>
        <PhoneFrame
          src="/images/landing/06-group-balances.webp"
          className={soloPhoneClass}
          alt="Grupo Viagem pra Floripa, 5 pessoas: Você tem R$ 312,40 pra receber. Quem paga quem: Eva para você R$ 129,00, Bruno para você R$ 128,10, Carla para você R$ 55,30 e Carla para Diego R$ 41,00."
        />
      </div>
    </LandingSection>
  );
}
