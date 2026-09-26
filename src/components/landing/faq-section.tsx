import { LandingSection, SectionHeading } from "./landing-section";

const QUESTIONS = [
  { question: "É de graça?", answer: "É. Sem assinatura, sem anúncio e sem taxa no seu Pix." },
  {
    question: "Preciso baixar alguma coisa?",
    answer: "Não. Funciona no navegador, e dá pra instalar na tela inicial se quiser.",
  },
  {
    question: "Meus amigos precisam ter conta?",
    answer: "Pra marcar os itens na sala, não. Pra acompanhar o saldo do grupo, entram com Google.",
  },
  {
    question: "O Dividimos mexe no meu dinheiro?",
    answer: "Nunca. Ele gera o Pix com o valor certo; o pagamento sai do app do seu banco.",
  },
  { question: "Como vocês guardam minha chave Pix?", answer: "Criptografada. No app ela só aparece mascarada." },
];

export function FaqSection() {
  return (
    <LandingSection id="duvidas">
      <SectionHeading eyebrow="Dúvidas" title="O que a galera pergunta." />
      <dl className="border-t border-border min-[900px]:columns-2 min-[900px]:gap-14">
        {QUESTIONS.map((item) => (
          <div key={item.question} className="break-inside-avoid border-b border-border px-0.5 py-4.5">
            <dt className="text-base font-black tracking-[-0.01em]">{item.question}</dt>
            <dd className="mt-1.5 max-w-[56ch] text-[15px] leading-[1.6] text-muted-foreground">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </LandingSection>
  );
}
