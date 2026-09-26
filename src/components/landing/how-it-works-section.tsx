import { LandingSection, SectionHeading } from "./landing-section";
import { PhoneFrame, PhoneRow } from "./phone-frame";

export function HowItWorksSection() {
  return (
    <LandingSection id="como-funciona">
      <SectionHeading eyebrow="Como funciona" title="Do cupom pro Pix, sem planilha." />
      <PhoneRow>
        <PhoneFrame
          src="/images/landing/01-bill-items.webp"
          step={1}
          caption="Foto da notinha"
          alt="Tela Recibo do app: Boteco da Esquina com cinco itens lidos da foto, subtotal R$ 229,90, taxa de serviço de 10% e total R$ 252,89, e o botão Criar sala de divisão."
        />
        <PhoneFrame
          src="/images/landing/02-room-board.webp"
          step={2}
          caption="Cada um marca o seu"
          alt="Sala do Boteco da Esquina com 4 pessoas: tela O que você consumiu? com a porção de fritas, a caipirinha e o guaraná ainda sem dono."
        />
        <PhoneFrame
          src="/images/landing/03-pix-qr.webp"
          step={3}
          caption="Pix no valor certo"
          alt="Tela Pagar Ana, R$ 84,34, com o QR code Pix, o botão Copiar código Pix e o botão Já paguei."
        />
      </PhoneRow>
    </LandingSection>
  );
}
