import { LandingSection, SectionHeading } from "./landing-section";
import { PhoneFrame, PhoneRow } from "./phone-frame";

export function GuestSection() {
  return (
    <LandingSection>
      <div className="grid gap-7 min-[960px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] min-[960px]:items-center min-[960px]:gap-12">
        <SectionHeading
          eyebrow="Sem app"
          title="Seu amigo não tem o app? Tudo bem."
          lede="Entra na sala só com o nome."
          className="mb-0"
        />
        <PhoneRow tilted>
          <PhoneFrame
            src="/images/landing/04-room-join.webp"
            caption="Entra com o nome"
            alt="Tela Sala de itens para quem não tem conta: campo Seu nome preenchido com Carla e o botão Entrar. Abaixo, Você pode vincular sua conta depois."
          />
          <PhoneFrame
            src="/images/landing/05-guest-share.webp"
            caption="Vê a parte dele"
            alt="Tela Ana encerrou a sala, vista pela Carla: Sua parte R$ 36,85 com 3 itens, o quadro final de todos e o botão Entrar com Google para vincular minha parte."
          />
        </PhoneRow>
      </div>
    </LandingSection>
  );
}
