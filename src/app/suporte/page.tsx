import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { buttonVariants } from "@/components/ui/button-variants";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Suporte do Dividimos",
};

const LINK_CLASS = "font-medium text-primary-text underline";

export default function SuportePage() {
  return (
    <div className="mx-auto h-dvh max-w-2xl overflow-y-auto px-4 py-12">
      <Link href="/" className="inline-block">
        <Logo size="sm" />
      </Link>

      <h1 className="mt-8 text-2xl font-bold">Suporte do Dividimos</h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-base font-semibold">Fale com a gente</h2>
          <p className="mt-2 text-muted-foreground">
            Mande um e-mail contando o que aconteceu, em qual aparelho e o seu @handle. Não mande sua
            chave Pix, senhas nem fotos de documentos.
          </p>
          <a
            href={`mailto:${BRAND.contact}`}
            className={`mt-4 inline-flex ${buttonVariants({ size: "lg" })}`}
          >
            {BRAND.contact}
          </a>
        </section>

        <section>
          <h2 className="text-base font-semibold">Não consegue entrar</h2>
          <p className="mt-2 text-muted-foreground">
            O Dividimos entra com Google e, no iPhone, também com Apple. Use a mesma conta com que
            você criou o seu perfil: com outra, você pode cair num perfil novo e vazio. Para entrar
            com as duas, conecte Apple e Google em Configurações, em “Contas conectadas”.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">O Pix não caiu</h2>
          <p className="mt-2 text-muted-foreground">
            O Dividimos não movimenta dinheiro: ele gera o QR code e o código Pix, e o pagamento
            acontece no app do seu banco. Confira no banco antes de marcar como recebido.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Alguém te incomodou</h2>
          <p className="mt-2 text-muted-foreground">
            Você pode denunciar uma mensagem ou uma pessoa. Bloquear corta a conversa direta entre
            vocês, e convites, lembretes e notificações dessa pessoa param de chegar.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Seus dados</h2>
          <p className="mt-2 text-muted-foreground">
            Veja{" "}
            <Link href="/excluir-conta" className={LINK_CLASS}>
              como excluir sua conta e o que é mantido
            </Link>
            , a{" "}
            <Link href="/privacy" className={LINK_CLASS}>
              Política de Privacidade
            </Link>{" "}
            e os{" "}
            <Link href="/terms" className={LINK_CLASS}>
              Termos de Uso
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
