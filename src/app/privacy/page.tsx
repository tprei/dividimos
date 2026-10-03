import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Política de Privacidade",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto h-dvh max-w-2xl overflow-y-auto px-4 py-12">
      <Link href="/" className="inline-block">
        <Logo size="sm" />
      </Link>

      <h1 className="mt-8 text-2xl font-bold">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: 27 de setembro de 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-base font-semibold">1. Dados que coletamos</h2>
          <p className="mt-2">
            O Dividimos usa os dados abaixo para manter sua conta, dividir despesas e permitir as
            interações que você escolhe no app.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Conta e perfil:</strong> nome, e-mail e endereço
              da foto de perfil recebidos no login com Google, além do nome e do handle que você
              usa no Dividimos, e suas preferências.
            </li>
            <li>
              <strong className="text-foreground">Chave Pix:</strong> se você cadastrar uma chave,
              guardamos o tipo, um trecho mascarado e a chave criptografada. A chave completa só é
              usada no servidor para gerar códigos Pix, e fica dentro do código gerado.
            </li>
            <li>
              <strong className="text-foreground">Despesas e grupos:</strong> nomes e fotos de
              grupos, títulos, valores, itens, participantes, divisões, pagamentos registrados e o
              histórico de alterações. Também guardamos os nomes e as escolhas de quem participa
              das salas de divisão de itens, e os nomes de convidados, inclusive os que vêm de um
              contato escolhido no aparelho.
            </li>
            <li>
              <strong className="text-foreground">Cobranças rápidas:</strong> o valor, a descrição
              opcional e a situação de cada cobrança que você cria para receber por Pix.
            </li>
            <li>
              <strong className="text-foreground">Conversas e segurança:</strong> as mensagens que
              você envia, registros de leitura, bloqueios e denúncias. Uma denúncia pode incluir o
              motivo, detalhes escritos por quem denuncia e uma cópia do texto denunciado.
            </li>
            <li>
              <strong className="text-foreground">Recursos de IA:</strong> a imagem do cupom ou da
              nota, o áudio gravado ou a transcrição da sua fala, o texto digitado para interpretar
              uma despesa e os nomes e handles dos participantes usados nessa interpretação. Esses
              dados só saem do dispositivo quando você usa o recurso depois de permitir o uso de
              IA.
            </li>
            <li>
              <strong className="text-foreground">Notificações:</strong> se você ativar
              notificações, guardamos o token do Firebase Cloud Messaging (FCM) do dispositivo ou a
              inscrição de Web Push do navegador, criptografados no nosso banco e ligados à sua
              conta.
            </li>
            <li>
              <strong className="text-foreground">Proteção contra abuso:</strong> usamos o
              identificador da sua conta e contadores de requisições para limitar o uso das APIs.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">2. Como usamos seus dados e a permissão de IA</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>Autenticar sua conta e manter sua sessão.</li>
            <li>
              Registrar e dividir despesas, calcular saldos e mostrar o histórico a quem participa.
            </li>
            <li>Gerar códigos Pix Copia e Cola para pagamentos feitos fora do Dividimos.</li>
            <li>Manter conversas, convites, salas de divisão de itens e as notificações que você ativar.</li>
            <li>
              Interpretar cupons, voz e texto para sugerir o preenchimento de despesas, que você
              revisa antes de confirmar.
            </li>
            <li>Aplicar bloqueios, analisar denúncias e proteger o app contra abuso.</li>
          </ul>
          <p className="mt-2">
            Antes do primeiro uso de um recurso de IA, o app pede uma permissão específica,
            separada da aceitação destes termos e desta política. A resposta fica guardada no
            próprio dispositivo, para a sua conta: em outro dispositivo, ou com outra conta no
            mesmo dispositivo, o app pergunta de novo.
          </p>
          <p className="mt-2">
            Se você não permitir, continua preenchendo despesas à mão e usando o chat comum.
            Recusar ou fechar o pedido não envia a imagem, o áudio ou o texto. Permitir o uso de IA
            não substitui as permissões de câmera e microfone do dispositivo.
          </p>
          <p className="mt-2">
            Para revogar, abra Configurações &gt; Inteligência artificial &gt; Revogar permissão.
            A revogação vale para o dispositivo em que você a fez e não recolhe dados que já foram
            enviados.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">3. Para onde os dados vão</h2>
          <p className="mt-2">
            Não vendemos seus dados. Para os recursos do app funcionarem, os dados passam pelos
            serviços e pessoas abaixo, conforme o que você usa.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Supabase:</strong> autenticação, banco de dados e
              fotos de grupos. Recebe os dados de conta, perfil, despesas, grupos, conversas,
              salas, preferências, notificações e segurança.
            </li>
            <li>
              <strong className="text-foreground">Vercel:</strong> hospeda o site e as APIs do
              Dividimos. Os dados enviados às nossas APIs passam por essa infraestrutura, inclusive
              os pedidos de IA encaminhados ao Google.
            </li>
            <li>
              <strong className="text-foreground">Google Gemini:</strong> recebe a imagem do cupom
              ou da nota para extrair itens e valores. Na despesa por voz, pode receber o áudio
              gravado para transcrever e recebe a transcrição para interpretar a despesa. Na
              entrada de texto com IA, recebe o texto digitado. A interpretação de voz e de texto
              também envia nomes e handles dos participantes, para identificar quem entrou na
              divisão. Valores e qualquer outra informação que você incluir na imagem, na fala ou no
              texto vão junto.
            </li>
            <li>
              <strong className="text-foreground">Serviço de fala do celular ou do navegador:</strong>{" "}
              dependendo do aparelho, a voz é reconhecida pelo serviço do sistema ou do navegador
              antes de a transcrição seguir para o Dividimos e o Gemini. Esse serviço pode enviar o
              áudio para servidores do Google ou da Apple; o reconhecimento não é garantidamente
              local. Quando o app usa o próprio gravador, o áudio segue pela nossa API até o
              Gemini.
            </li>
            <li>
              <strong className="text-foreground">Serviços de notificação:</strong> o FCM e os
              serviços de Web Push recebem o necessário para entregar as notificações, que podem
              trazer nomes de pessoas e grupos, títulos de despesas e valores, como a sua parte numa
              despesa. Tokens e inscrições ficam criptografados no nosso banco.
            </li>
            <li>
              <strong className="text-foreground">Telegram:</strong> as denúncias vão para o canal
              de moderação da equipe, com o identificador da denúncia, o motivo e, quando houver, os
              handles de quem denunciou e de quem foi denunciado, o nome do grupo, os detalhes e um
              trecho do texto denunciado. A denúncia e a cópia do texto também ficam no banco, com
              acesso só da moderação.
            </li>
            <li>
              <strong className="text-foreground">Outras pessoas no Dividimos:</strong> nome,
              handle e foto identificam seu perfil. Quem participa vê as despesas, divisões,
              pagamentos e conversas a que tem acesso. No perfil, os outros veem só o tipo e o
              trecho mascarado da sua chave Pix. O código com a chave completa é gerado para quem
              tem saldo a te pagar e quando você mesmo gera um código para receber, como na cobrança
              rápida; quem recebe ou lê esse código vê a chave completa.
            </li>
            <li>
              <strong className="text-foreground">Contatos e WhatsApp:</strong> ao escolher um
              contato para uma despesa, o nome dele, ou o número quando o contato não tem nome, vira
              o nome de um convidado, guardado no Dividimos e visível para quem participa da
              despesa. O telefone fica no dispositivo e serve para montar links de convite ou de
              compartilhamento no WhatsApp; ao abrir o link, o número e o texto seguem para o
              WhatsApp.
            </li>
          </ul>
          <p className="mt-2">
            Esses serviços têm regras próprias de tratamento e retenção. Não conseguimos apagar,
            pelo Dividimos, dados que Google, Apple, Telegram ou outros serviços já tenham
            recebido.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">4. Permissões e dados no dispositivo</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Microfone:</strong> usado quando você escolhe a
              despesa por voz. A fala passa pelo reconhecedor do aparelho ou do navegador, ou é
              gravada por um instante e enviada à nossa API para o Gemini transcrever.
            </li>
            <li>
              <strong className="text-foreground">Câmera e fotos:</strong> usadas quando você
              escaneia um cupom ou uma nota, ou lê um QR code. A imagem do cupom enviada para
              interpretação segue para o Gemini. Fotos escolhidas para um grupo ficam no
              armazenamento do Supabase.
            </li>
            <li>
              <strong className="text-foreground">Contatos:</strong> você escolhe os contatos no
              aparelho, sem enviar sua agenda ao Dividimos. O nome do contato escolhido para uma
              despesa, ou o número quando não há nome, vira o nome de um convidado; o telefone só é
              usado para o link do WhatsApp. Não criamos nem alteramos contatos. No Android, a
              permissão de escrita aparece junto porque o plugin de contatos exige as duas; o
              Dividimos não escreve na sua agenda.
            </li>
            <li>
              <strong className="text-foreground">Notificações:</strong> são opcionais. Dá para
              desligar no app ou nas configurações do aparelho; desligar no app remove a inscrição
              do nosso serviço.
            </li>
            <li>
              <strong className="text-foreground">Armazenamento local:</strong> o app guarda no
              dispositivo os dados sincronizados, rascunhos, preferências e a sua resposta à
              permissão de IA. A exclusão da conta apaga esses dados da conta no dispositivo em que
              você conclui a exclusão.
            </li>
          </ul>
          <p className="mt-2">
            O Dividimos não coleta o identificador de publicidade e não usa ferramentas de
            analytics no app.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">5. Segurança</h2>
          <p className="mt-2">
            A comunicação com nossos servidores usa HTTPS. Chaves Pix, tokens do FCM e inscrições
            de Web Push são criptografados com AES-256-GCM antes de irem para o banco.
          </p>
          <p className="mt-2">
            O acesso aos dados passa por verificação de conta e, quando necessário, de participação
            no grupo ou na conversa. As tabelas têm segurança em nível de linha (RLS), e o app só
            lê e grava por funções e APIs que conferem essas permissões.
          </p>
          <p className="mt-2">
            Criptografia no armazenamento e no transporte não é criptografia de ponta a ponta: o
            servidor precisa processar as informações para os recursos funcionarem, e a moderação
            pode ver as evidências de uma denúncia.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">6. Retenção e exclusão da conta</h2>
          <p className="mt-2">
            Guardamos os dados de conta e de uso enquanto o Dividimos precisa deles para
            funcionar. O histórico compartilhado de despesas, versões, pagamentos e eventos não
            expira, porque sustenta os saldos e o histórico das outras pessoas. Denúncias e suas
            evidências ficam guardadas para análise de segurança, mesmo depois da exclusão da
            conta ou da mensagem original.
          </p>
          <p className="mt-2">
            Não salvamos imagens de cupons nem gravações de voz como arquivos no nosso banco ou
            armazenamento: elas passam pelas APIs e pelo Gemini, e isso não é uma promessa sobre a
            retenção do Google. Transcrições e interpretações podem ficar nos rascunhos do
            dispositivo e, quando você confirma uma despesa ou envia uma mensagem, nos registros
            dela. Fotos de grupos ficam com o grupo; excluir sua conta não apaga essas fotos.
          </p>
          <p className="mt-2">
            Para excluir sua conta do Dividimos, entre no app, abra Configurações e toque em
            “Excluir sua conta do Dividimos”. Antes, seus saldos precisam estar zerados em todos os
            grupos, tanto o que você deve quanto o que tem a receber, inclusive em conversas e em
            grupos de que você já saiu. Se houver pendências, o app mostra quais grupos precisam de
            acerto. Se não conseguir resolver uma pendência, fale com a gente.
          </p>
          <p className="mt-2">
            Na exclusão, seu nome passa a aparecer como “Conta excluída”. Seu e-mail, o endereço da
            foto de perfil e o handle são apagados ou trocados por valores que não identificam você;
            sua chave Pix, suas cobranças rápidas, seus bloqueios e os bloqueios feitos contra você
            são apagados, suas inscrições de notificação e registros de leitura são removidos, e seu
            handle anterior fica livre e deixa de aparecer na busca.
          </p>
          <p className="mt-2">
            Você sai dos grupos e seus links de convite são desativados. Grupos que você criou
            passam para o integrante que entrou primeiro, se houver outro. Salas de divisão de
            itens que você hospeda e que não foram finalizadas são canceladas e apagadas. Os
            convidados que você assumiu, inclusive nas versões anteriores das despesas, sua
            participação em salas ligada à conta e os avisos de que você entrou no lugar de um
            convidado passam a mostrar “Conta excluída”. Ficam como foram escritos os nomes de
            convidados que você não assumiu, mesmo que alguém tenha digitado o seu nome, e o nome
            usado numa sala em que você entrou como convidado, sem vínculo com a conta.
          </p>
          <p className="mt-2">
            O texto das mensagens que você enviou é apagado e aparece como “Mensagem apagada”, de
            “Conta excluída”. Uma cópia de uma mensagem já denunciada pode continuar nas evidências
            da moderação. A exclusão não apaga mensagens de outras pessoas nem procura seu nome em
            textos escritos por elas.
          </p>
          <p className="mt-2">
            Despesas, versões, pagamentos registrados e eventos do histórico financeiro continuam
            ligados a um identificador interno do perfil excluído, para não mudar os saldos e o
            histórico das outras pessoas. Ou seja: a exclusão apaga ou anonimiza o perfil e os dados
            de uso, mas não elimina todos os registros ligados à conta.
          </p>
          <p className="mt-2">
            A conta de autenticação é desativada e mantém só o identificador interno necessário a
            esses registros. A exclusão não pode ser desfeita: se você entrar de novo com o mesmo
            Google ou a mesma Apple ID, será uma conta nova do Dividimos. Sua conta Google ou Apple
            não é excluída. Se você entrava com Apple, a autorização do Dividimos na sua Apple ID é
            revogada na exclusão.
          </p>
          <p className="mt-2">
            Ao concluir, o app encerra sua sessão e apaga os dados locais da conta no dispositivo
            usado, inclusive a resposta à permissão de IA. Não conseguimos apagar na hora cópias que
            já estejam em outros aparelhos, notificações já entregues ou dados que outra pessoa
            tenha copiado; outros aparelhos recebem os registros atualizados quando sincronizam.
          </p>
          <p className="mt-2">
            As instruções também estão na página pública{" "}
            <Link href="/excluir-conta" className="font-medium text-primary-text underline">
              Excluir sua conta do Dividimos
            </Link>
            , que abre sem login. Para ajuda ou pedidos sobre seus dados, use o contato no fim desta
            política.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">7. Denúncias e moderação</h2>
          <p className="mt-2">
            Você pode denunciar uma mensagem ou uma pessoa pelo app, com o motivo e, se quiser,
            detalhes. Guardamos quem denunciou, quem foi denunciado, o contexto disponível e uma
            cópia do texto da mensagem, quando houver. Esses registros não aparecem no chat nem
            para outros usuários; servem só para a análise da equipe.
          </p>
          <p className="mt-2">
            As denúncias chegam à equipe pelo Telegram. Podemos apagar mensagens e suspender contas
            que violem os Termos de Uso. Analisamos as denúncias em até 7 dias; esse é o prazo de
            análise, não uma promessa de remoção ou suspensão em todos os casos.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">8. Bloqueio de pessoas</h2>
          <p className="mt-2">
            Você pode bloquear alguém pelo perfil e gerenciar os bloqueios em Configurações.
            Guardamos o bloqueio para aplicá-lo, e a outra pessoa não é avisada.
          </p>
          <p className="mt-2">
            O bloqueio vale nos dois sentidos para conversas 1-a-1, novas ou existentes, novos
            convites de grupo, inclusão como novo participante de uma despesa ou de uma sala criada
            por um de vocês e lembretes de cobrança. Entre vocês, também deixam de valer um convite
            que já estava pendente, um link de convite de grupo criado por um de vocês e o resgate
            da parte de um convidado numa despesa criada pelo outro; convites e links de outros
            membros continuam funcionando. Numa sala aberta por link, a pessoa bloqueada entra como
            convidada, sem vínculo com a conta dela.
          </p>
          <p className="mt-2">
            Nos grupos que vocês já compartilham, as mensagens da pessoa bloqueada ficam ocultas pra
            você, e as notificações das ações dela param de chegar. O bloqueio não tira ninguém do
            grupo, não apaga mensagens do banco e não muda despesas, saldos ou o histórico
            financeiro; correções em despesas que mantêm os participantes continuam possíveis.
            Ocultar mensagens é uma regra de exibição do app, não torna secreto o conteúdo de um
            grupo compartilhado.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">9. Seus direitos pela LGPD</h2>
          <p className="mt-2">
            Pela LGPD (Lei 13.709/2018), você pode pedir confirmação do tratamento e acesso aos seus
            dados, correção de dados incompletos ou errados, informações sobre compartilhamento e,
            nos casos previstos em lei, anonimização, bloqueio, eliminação ou portabilidade. Também
            pode revogar seu consentimento e se opor a tratamentos nas hipóteses da lei.
          </p>
          <p className="mt-2">
            Para exercer esses direitos, escreva para o contato abaixo. Podemos precisar confirmar
            sua identidade. Na resposta, explicamos o que dá para atender e quais registros precisam
            ser mantidos, como o histórico financeiro compartilhado e as evidências de moderação.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">10. Contato</h2>
          <p className="mt-2">
            Para dúvidas sobre privacidade, pedidos sobre seus dados, ajuda com a exclusão da conta
            ou suporte:{" "}
            <a href={`mailto:${BRAND.contact}`} className="font-medium text-primary-text underline">
              {BRAND.contact}
            </a>
            . Respondemos e-mails de suporte e analisamos denúncias em até 7 dias.
          </p>
        </section>
      </div>
    </div>
  );
}
