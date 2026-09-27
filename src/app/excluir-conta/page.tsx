import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { buttonVariants } from "@/components/ui/button-variants";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Excluir sua conta do Dividimos",
};

type ExcluirContaSearchParams = Promise<{ excluida?: string | string[]; limpeza?: string | string[] }>;

export default async function ExcluirContaPage({
  searchParams,
}: {
  searchParams: ExcluirContaSearchParams;
}) {
  const { excluida, limpeza } = await searchParams;
  const showSuccessBanner = excluida === "1";
  const partialDeviceWipe = showSuccessBanner && limpeza === "parcial";

  return (
    <div className="mx-auto h-dvh max-w-2xl overflow-y-auto px-4 py-12">
      <Link href="/" className="inline-block">
        <Logo size="sm" />
      </Link>

      <h1 className="mt-8 text-2xl font-bold">Excluir sua conta do Dividimos</h1>

      {showSuccessBanner && (
        <div
          role="status"
          className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm font-medium"
        >
          <p>Sua conta do Dividimos foi excluída.</p>
          {partialDeviceWipe && (
            <p className="mt-2 font-normal">
              Não deu para apagar tudo o que ficou guardado neste aparelho. Para terminar, limpe os
              dados do Dividimos nas configurações do navegador ou do celular.
            </p>
          )}
        </div>
      )}

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-base font-semibold">Como excluir</h2>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">
            <li>
              Entre no Dividimos, abra Configurações e toque em “Excluir sua conta do Dividimos”.
            </li>
            <li>
              Antes de excluir, seus saldos precisam estar zerados em todos os grupos. Se houver
              pendências, mostramos quais grupos você precisa acertar.
            </li>
          </ol>
          <a
            href="/auth?next=%2Fapp%2Fsettings%3Fexcluir%3D1"
            className={`mt-4 inline-flex ${buttonVariants({ size: "lg" })}`}
          >
            Entrar para excluir minha conta
          </a>
        </section>

        <section>
          <h2 className="text-base font-semibold">O que é apagado</h2>
          <p className="mt-2 text-muted-foreground">
            Seu nome, e-mail, foto, chave Pix e preferências são apagados ou anonimizados. Você sai
            dos grupos, seus links de convite são desativados e suas mensagens aparecem como
            “Mensagem apagada”, de “Conta excluída”.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">O que fica</h2>
          <p className="mt-2 text-muted-foreground">
            Despesas, pagamentos e o histórico financeiro compartilhado são mantidos para não alterar
            os saldos das outras pessoas. Nomes de convidados que você não assumiu ficam como foram
            escritos, mesmo que alguém tenha digitado o seu nome. Registros de
            denúncias podem ser mantidos para análise de segurança.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Precisa de ajuda?</h2>
          <p className="mt-2 text-muted-foreground">
            A exclusão não pode ser desfeita. Se você entrar de novo com o mesmo Google, uma nova
            conta será criada.
          </p>
          <p className="mt-2">
            Precisa de ajuda? Fale com{" "}
            <a
              href={`mailto:${BRAND.contact}`}
              className={`inline-flex ${buttonVariants({ variant: "outline", size: "sm" })}`}
            >
              {BRAND.contact}
            </a>
            . Analisamos sua solicitação em até 7 dias.
          </p>
        </section>
      </div>
    </div>
  );
}
