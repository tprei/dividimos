<p align="center">
  <img src=".github/banner.svg" alt="dividimos.ai" width="600" />
</p>

<p align="center">
  Racha a conta com a galera e liquida via Pix em segundos.
</p>

<p align="center">
  <a href="https://www.dividimos.ai">Web</a> &middot;
  <a href="https://play.google.com/store/apps/details?id=ai.dividimos.app">Android (WIP)</a>
</p>

---

Escaneie uma nota fiscal ou digite o valor total, distribua os itens entre as pessoas e liquide via QR Code Pix. Sem ficar calculando no grupo do WhatsApp.

## Funcionalidades

- **Dois modos de conta** &mdash; Itemizada (nota de restaurante com itens por pessoa) ou valor unico (Uber, Airbnb, etc.)
- **Divisao flexivel** &mdash; Igual, por porcentagem (com sliders visuais) ou valor fixo por pessoa
- **Multi-pagador** &mdash; Registre quem pagou quanto quando mais de uma pessoa cobriu a conta
- **Taxa de servico** &mdash; Percentual ou valor fixo aplicado automaticamente
- **QR Code Pix** &mdash; Geracao de BR Code EMV com Copia e Cola para liquidacao instantanea
- **Simplificacao de dividas** &mdash; Minimiza transferencias com visualizacao passo a passo
- **Sync em tempo real** &mdash; Supabase Realtime mantem todos os participantes atualizados
- **Grupos** &mdash; Crie grupos, convide por @handle, divida contas entre membros aceitos
- **Seguro** &mdash; Chaves Pix criptografadas com AES-256-GCM em repouso, descriptografadas apenas no servidor

## Stack

| Camada | Tecnologia |
|--------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS v4, shadcn/ui, Framer Motion |
| Estado | Zustand |
| Backend | Supabase (PostgreSQL + Auth + Realtime) |
| Auth | Google OAuth (web), Google Credential Manager (Android nativo) |
| Deploy | Vercel (frontend), Supabase (banco de dados) |
| Mobile | Capacitor 8 (Android) |
| Linguagem | TypeScript 5 |

## Comecando

### Requisitos

- Node.js 22+
- Um projeto [Supabase](https://supabase.com) (regiao Sao Paulo recomendada)

### Setup

```bash
git clone https://github.com/tprei/dividimos.git
cd dividimos
npm install
```

Crie `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
PIX_ENCRYPTION_KEY=<string hex de 64 caracteres>
```

Gere a chave de criptografia:

```bash
openssl rand -hex 32
```

Aplique as migracoes:

```bash
supabase db push --linked
```

Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Estrutura

```
src/
├── app/                    # Paginas (Next.js App Router)
│   ├── page.tsx            # Landing page
│   ├── demo/               # Demo publica (sem auth)
│   ├── auth/               # Google OAuth + onboarding
│   ├── app/                # Shell autenticado
│   │   ├── bill/new/       # Wizard de criacao de conta
│   │   ├── bill/[id]/      # Detalhe + liquidacao
│   │   ├── groups/         # Gestao de grupos
│   │   └── profile/        # Configuracoes + chave Pix
│   └── api/
│       ├── pix/generate/   # Geracao de QR Pix (server-side)
│       └── users/lookup/   # Busca exata por @handle
├── components/
│   ├── bill/               # Steps do wizard + resumo
│   ├── settlement/         # Modal QR, grafo de dividas
│   └── ui/                 # Primitivos shadcn/ui
├── stores/
│   └── bill-store.ts       # Zustand store
├── lib/
│   ├── crypto.ts           # AES-256-GCM (server-only)
│   ├── pix.ts              # EMV BR Code + CRC16-CCITT
│   ├── simplify.ts         # Algoritmo de simplificacao de dividas
│   ├── currency.ts         # Formatacao BRL (centavos inteiros)
│   ├── capacitor/          # Bridge nativo (Android/iOS)
│   └── supabase/           # Clientes + sync
├── hooks/                  # React hooks
└── types/                  # Tipos do dominio + banco
android/                    # Projeto nativo Android (Capacitor)
supabase/
└── migrations/             # Schema PostgreSQL + RLS
```

## Como funciona

### Criacao de conta

1. Escolha o tipo &mdash; itemizada ou valor unico
2. Adicione titulo, estabelecimento, data
3. Adicione participantes por @handle
4. Entre os itens ou o valor total
5. Distribua o consumo ou escolha um metodo de divisao
6. Selecione quem pagou e quanto
7. Revise e crie

### Liquidacao

O app computa um ledger de quem deve pra quem. O algoritmo de simplificacao reduz o numero de transferencias:

1. Calcula arestas brutas a partir dos dados de consumo e pagamento
2. Saldo liquido por participante
3. Pareamento guloso de devedores com credores
4. Colapso de cadeias e compensacao de pares reversos

Cada participante pode gerar um QR Code Pix para pagar sua parte direto.

### Seguranca

- Chaves Pix **criptografadas em repouso** (AES-256-GCM) e **descriptografadas apenas no servidor**
- Row-Level Security em todas as tabelas do Supabase
- Descoberta de usuarios apenas por **@handle exato** &mdash; sem busca ou enumeracao
- Geracao de QR exige co-participacao autenticada na conta

## Comandos

```bash
npm run dev              # Servidor de desenvolvimento
npm run build            # Build de producao
npm run lint             # ESLint
npm run test             # Testes unitarios
npm run test:integration # Testes de integracao
```

### Android

```bash
npx cap sync android                  # Sincronizar projeto Android
npm run cap:assets                    # Gerar icones e splash screens
cd android && ./gradlew assembleDebug # Build debug APK
```

## Convencoes

- Todo dinheiro e **centavos inteiros** &mdash; nunca ponto flutuante
- Todo texto visivel ao usuario e **portugues (pt-BR)**
- Supabase usa `gen_random_uuid()`, nao `uuid_generate_v4()`

## Licenca

Privado. Todos os direitos reservados.
