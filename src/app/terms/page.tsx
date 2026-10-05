import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Termos de Uso",
};

export default function TermsPage() {
  return (
    <div className="mx-auto h-dvh max-w-2xl overflow-y-auto px-4 py-12">
      <Link href="/" className="inline-block">
        <Logo size="sm" />
      </Link>

      <h1 className="mt-8 text-2xl font-bold">Termos de Uso</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: 5 de outubro de 2026
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
            O Dividimos não é uma instituição financeira e não processa nem intermedia pagamentos. O
            app guarda os registros de despesas e pagamentos informados pelos participantes para
            calcular saldos e manter o histórico. Os códigos Pix são uma conveniência para facilitar
            o pagamento direto entre usuários, fora do Dividimos.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">3. Conta e responsabilidades</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              Você é responsável por manter a segurança da sua conta Google ou do seu Apple ID
              utilizados para autenticação.
            </li>
            <li>
              O handle escolhido durante o cadastro é único e público dentro da plataforma, sendo
              utilizado para convites de grupo.
            </li>
            <li>
              Você é responsável pela veracidade das informações fornecidas, incluindo sua chave Pix.
            </li>
            <li>
              Ao fornecer uma chave Pix, você autoriza o servidor a descriptografá-la apenas para
              gerar códigos Pix: o de pagamento para um participante que tenha um saldo a te pagar e
              os que você mesmo gera para receber, como na cobrança rápida. A chave completa fica
              embutida nesses códigos; no perfil, só aparecem o tipo e um trecho mascarado.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">4. Uso aceitável</h2>
          <p className="mt-2">
            O Dividimos não tolera conteúdo ofensivo nem pessoas abusivas. Você concorda em não:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>Usar o Dividimos para atividades ilegais, golpes, fraudes, spam ou divulgação enganosa.</li>
            <li>
              Enviar conteúdo de assédio, discriminação, discurso de ódio, ameaças ou incentivo à
              violência.
            </li>
            <li>
              Enviar conteúdo sexual explícito, de exploração sexual ou qualquer conteúdo de abuso
              sexual de crianças e adolescentes.
            </li>
            <li>
              Expor dados pessoais de outra pessoa sem autorização, se passar por outra pessoa ou
              usar o app para perseguir ou constranger alguém.
            </li>
            <li>
              Criar despesas falsas ou fraudulentas, manipular registros para enganar participantes
              ou usar cobranças para intimidar alguém.
            </li>
            <li>
              Tentar acessar contas ou dados sem autorização, contornar bloqueios ou interferir no
              funcionamento e na segurança do serviço.
            </li>
          </ul>
          <p className="mt-2">
            Se encontrar uma mensagem ou um perfil que viole estas regras, use a opção de denúncia
            no app. Você também pode bloquear a pessoa pelo perfil e gerenciar os bloqueios em
            Configurações. O bloqueio impede conversas diretas, novos convites, lembretes e que um
            inclua o outro em novas divisões, e oculta pra você as mensagens da pessoa nos grupos
            que vocês compartilham, sem tirar ninguém do grupo nem mudar despesas, saldos ou o
            histórico financeiro. Entre vocês, também deixam de valer um convite pendente, um link
            de convite de grupo criado por um de vocês e o resgate da parte de um convidado; pelo
            link de uma sala, a pessoa bloqueada só entra como convidada.
          </p>
          <p className="mt-2">
            A equipe analisa denúncias em até 24 horas e pode apagar mensagens e suspender contas que
            violem estes termos. As medidas dependem da análise de cada caso; denunciar alguém não
            garante remoção ou suspensão.
          </p>
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
            <Link href="/privacy" className="font-medium text-primary-text underline">
              Política de Privacidade
            </Link>
            , que complementa estes Termos de Uso.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">10. Encerramento e exclusão da conta</h2>
          <p className="mt-2">
            Você pode parar de usar o Dividimos quando quiser. Para excluir sua conta do Dividimos,
            abra Configurações e toque em “Excluir sua conta do Dividimos”. Antes, é preciso zerar
            seus saldos, a pagar e a receber, em todos os grupos e conversas. O app mostra as
            pendências que impedem a exclusão.
          </p>
          <p className="mt-2">
            A exclusão apaga ou anonimiza seu perfil, apaga sua chave Pix, desliga suas
            notificações, tira você dos grupos e apaga o texto das suas mensagens, que passam a
            aparecer como “Mensagem apagada”, de “Conta excluída”. Despesas, pagamentos e o
            histórico financeiro continuam ligados a um identificador interno para preservar os
            saldos das outras pessoas, e evidências de denúncias podem continuar guardadas para
            moderação. A exclusão é irreversível e não exclui sua conta Google nem sua conta Apple;
            se você entrou com a Apple, a autorização do login com a Apple é revogada na exclusão.
          </p>
          <p className="mt-2">
            A página{" "}
            <Link href="/excluir-conta" className="font-medium text-primary-text underline">
              Excluir sua conta do Dividimos
            </Link>{" "}
            explica o procedimento e abre sem login. O tratamento dos dados segue a{" "}
            <Link href="/privacy" className="font-medium text-primary-text underline">
              Política de Privacidade
            </Link>
            .
          </p>
          <p className="mt-2">
            Podemos suspender o acesso de uma conta que viole estes termos. A suspensão não apaga os
            registros financeiros nem cancela o que os participantes devem entre si.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">11. Contato</h2>
          <p className="mt-2">
            Para dúvidas sobre estes termos, suporte, ajuda com a exclusão da conta ou revisão de uma
            medida de moderação:{" "}
            <a href={`mailto:${BRAND.contact}`} className="font-medium text-primary-text underline">
              {BRAND.contact}
            </a>
            . Respondemos e-mails em até 7 dias; denúncias feitas pelo app são analisadas em até 24
            horas.
          </p>
        </section>
      </div>
    </div>
  );
}
