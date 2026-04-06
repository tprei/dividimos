import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";

export const metadata: Metadata = {
  title: "Política de Privacidade",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="inline-block">
        <Logo size="sm" />
      </Link>

      <h1 className="mt-8 text-2xl font-bold">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: 6 de abril de 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-base font-semibold">1. Dados que coletamos</h2>
          <p className="mt-2">
            Ao usar o Dividimos, coletamos apenas os dados necessários para o funcionamento do
            serviço:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Conta Google:</strong> nome, e-mail e foto de
              perfil usados para autenticação via Google OAuth.
            </li>
            <li>
              <strong className="text-foreground">Handle e chave Pix:</strong> escolhidos por você
              durante o cadastro. A chave Pix é criptografada (AES-256-GCM) antes do
              armazenamento. Ela só é compartilhada com membros do grupo mediante seu
              consentimento (ao aceitar um convite), e você é notificado antes de qualquer
              exposição.
            </li>
            <li>
              <strong className="text-foreground">Despesas e grupos:</strong> títulos, valores,
              itens, participantes e pagamentos criados por você dentro do app.
            </li>
            <li>
              <strong className="text-foreground">Áudio de voz:</strong> quando você usa a função
              de despesa por voz, o áudio é processado em tempo real no dispositivo (via Web
              Speech API ou reconhecimento nativo) e convertido em texto. O texto transcrito é
              enviado ao servidor para extração de dados. Não armazenamos gravações de áudio.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">2. Como usamos seus dados</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>Autenticar sua identidade e manter sua sessão.</li>
            <li>Criar, dividir e gerenciar despesas entre participantes.</li>
            <li>Gerar códigos Pix Copia e Cola para pagamentos.</li>
            <li>Processar transcrições de voz para preencher despesas automaticamente.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">3. Compartilhamento de dados</h2>
          <p className="mt-2">
            Não vendemos seus dados. Compartilhamos informações apenas com:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Supabase:</strong> hospedagem do banco de dados
              e autenticação.
            </li>
            <li>
              <strong className="text-foreground">Google (Gemini API):</strong> processamento de
              texto de voz e escaneamento de notas fiscais. Apenas o texto transcrito é enviado,
              não o áudio.
            </li>
            <li>
              <strong className="text-foreground">Membros do grupo:</strong> outros participantes
              do seu grupo veem nome, handle e foto de perfil — nunca sua chave Pix completa.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">4. Permissões do dispositivo</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong className="text-foreground">Microfone:</strong> usado exclusivamente para a
              função de despesa por voz. Solicitado apenas quando você toca no botão de
              microfone. O áudio é processado localmente e não é gravado nem armazenado.
            </li>
            <li>
              <strong className="text-foreground">Câmera:</strong> usada para escanear cupons
              fiscais e QR Codes NFC-e. As imagens são processadas e descartadas imediatamente.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">5. Segurança</h2>
          <p className="mt-2">
            Chaves Pix são criptografadas com AES-256-GCM no servidor antes do armazenamento. A
            comunicação entre o app e o servidor é protegida por HTTPS. Políticas de segurança em
            nível de linha (RLS) garantem que cada usuário acessa apenas seus próprios dados.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">6. Retenção e exclusão</h2>
          <p className="mt-2">
            Seus dados são mantidos enquanto sua conta estiver ativa. Para solicitar a exclusão da
            sua conta e todos os dados associados, entre em contato pelo e-mail abaixo.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">7. Contato</h2>
          <p className="mt-2">
            Para dúvidas sobre privacidade:{" "}
            <a
              href="mailto:privacy@dividimos.ai"
              className="font-medium text-primary underline"
            >
              privacy@dividimos.ai
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
