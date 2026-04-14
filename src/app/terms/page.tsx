import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";

export const metadata: Metadata = {
  title: "Termos de Uso",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="inline-block">
        <Logo size="sm" />
      </Link>

      <h1 className="mt-8 text-2xl font-bold">Termos de Uso</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: 14 de abril de 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-base font-semibold">1. Aceitação dos termos</h2>
          <p className="mt-2">
            Ao acessar ou usar o Dividimos, você concorda com estes Termos de Uso. Se não concordar
            com algum dos termos, não utilize o serviço.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">2. Descrição do serviço</h2>
          <p className="mt-2">
            O Dividimos é uma plataforma para divisão de despesas entre grupos. O serviço permite
            criar grupos, registrar despesas, calcular saldos e gerar códigos Pix Copia e Cola para
            facilitar pagamentos entre participantes.
          </p>
          <p className="mt-2">
            O Dividimos não é uma instituição financeira e não processa, intermedia ou armazena
            transações financeiras. Os códigos Pix gerados são apenas uma conveniência para
            facilitar o pagamento direto entre usuários.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">3. Conta e responsabilidades</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              Você é responsável por manter a segurança da sua conta Google utilizada para
              autenticação.
            </li>
            <li>
              O handle escolhido durante o cadastro é único e público dentro da plataforma, sendo
              utilizado para convites de grupo.
            </li>
            <li>
              Você é responsável pela veracidade das informações fornecidas, incluindo sua chave Pix.
            </li>
            <li>
              Ao fornecer uma chave Pix, você autoriza que ela seja compartilhada de forma mascarada
              com membros dos seus grupos para fins de pagamento.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">4. Uso aceitável</h2>
          <p className="mt-2">Você concorda em não:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>Usar o serviço para fins ilegais ou não autorizados.</li>
            <li>Criar despesas falsas ou fraudulentas.</li>
            <li>
              Tentar acessar dados de outros usuários fora dos mecanismos previstos pelo app.
            </li>
            <li>Interferir no funcionamento da plataforma ou de sua infraestrutura.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">5. Propriedade intelectual</h2>
          <p className="mt-2">
            Todo o conteúdo, design e código do Dividimos são protegidos por direitos autorais. Você
            não pode copiar, modificar ou distribuir qualquer parte do serviço sem autorização
            prévia.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">6. Pagamentos e Pix</h2>
          <p className="mt-2">
            O Dividimos gera códigos Pix Copia e Cola como conveniência. O app não processa, valida
            ou garante nenhuma transação financeira. A responsabilidade pelo envio e recebimento de
            pagamentos é exclusivamente dos usuários envolvidos. O Dividimos não se responsabiliza
            por pagamentos realizados para chaves incorretas ou por falhas no sistema Pix.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">7. Limitação de responsabilidade</h2>
          <p className="mt-2">
            O Dividimos é fornecido &ldquo;como está&rdquo;, sem garantias de qualquer tipo. Não nos
            responsabilizamos por perdas financeiras, danos diretos ou indiretos decorrentes do uso
            do serviço, incluindo erros de cálculo, indisponibilidade temporária ou falhas em
            integrações de terceiros.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">8. Alterações nos termos</h2>
          <p className="mt-2">
            Podemos atualizar estes termos periodicamente. Alterações significativas serão
            comunicadas através do app. O uso continuado do serviço após alterações constitui
            aceitação dos novos termos.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">9. Privacidade</h2>
          <p className="mt-2">
            O tratamento dos seus dados pessoais é regido pela nossa{" "}
            <Link href="/privacy" className="font-medium text-primary underline">
              Política de Privacidade
            </Link>
            , que complementa estes Termos de Uso.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">10. Contato</h2>
          <p className="mt-2">
            Para dúvidas sobre estes termos:{" "}
            <a
              href="mailto:contato@dividimos.ai"
              className="font-medium text-primary underline"
            >
              contato@dividimos.ai
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
