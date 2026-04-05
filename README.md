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

- **Dois modos de conta** &mdash; Itemizada (nota de restaurante com itens por pessoa) ou valor único (Uber, Airbnb, etc.)
- **Divisão flexível** &mdash; Igual, por porcentagem (com sliders visuais) ou valor fixo por pessoa
- **Multi-pagador** &mdash; Registre quem pagou quanto quando mais de uma pessoa cobriu a conta
- **Taxa de serviço** &mdash; Percentual ou valor fixo aplicado automaticamente
- **QR Code Pix** &mdash; Geração de BR Code EMV com Copia e Cola para liquidação instantânea
- **Simplificação de dívidas** &mdash; Minimiza transferências com visualização passo a passo
- **Sync em tempo real** &mdash; Supabase Realtime mantém todos os participantes atualizados
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

## Começando

### Requisitos

- Node.js 22+
- Um projeto [Supabase](https://supabase.com) (região São Paulo recomendada)

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

Aplique as migrações:

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
├── app/                    # Páginas (Next.js App Router)
│   ├── page.tsx            # Landing page
│   ├── demo/               # Demo pública (sem auth)
│   ├── auth/               # Google OAuth + onboarding
│   ├── app/                # Shell autenticado
│   │   ├── bill/new/       # Wizard de criação de conta
│   │   ├── bill/[id]/      # Detalhe + liquidação
│   │   ├── groups/         # Gestão de grupos
│   │   └── profile/        # Configurações + chave Pix
│   └── api/
│       ├── pix/generate/   # Geração de QR Pix (server-side)
│       └── users/lookup/   # Busca exata por @handle
├── components/
│   ├── bill/               # Steps do wizard + resumo
│   ├── settlement/         # Modal QR, grafo de dívidas
│   └── ui/                 # Primitivos shadcn/ui
├── stores/
│   └── bill-store.ts       # Zustand store
├── lib/
│   ├── crypto.ts           # AES-256-GCM (server-only)
│   ├── pix.ts              # EMV BR Code + CRC16-CCITT
│   ├── simplify.ts         # Algoritmo de simplificação de dívidas
│   ├── currency.ts         # Formatação BRL (centavos inteiros)
│   ├── capacitor/          # Bridge nativo (Android/iOS)
│   └── supabase/           # Clientes + sync
├── hooks/                  # React hooks
└── types/                  # Tipos do domínio + banco
android/                    # Projeto nativo Android (Capacitor)
supabase/
└── migrations/             # Schema PostgreSQL + RLS
```

## Como funciona

### Criação de conta

1. Escolha o tipo &mdash; itemizada ou valor único
2. Adicione título, estabelecimento, data
3. Adicione participantes por @handle
4. Entre os itens ou o valor total
5. Distribua o consumo ou escolha um método de divisão
6. Selecione quem pagou e quanto
7. Revise e crie

### Liquidação e simplificação de dívidas

O app computa um grafo direcionado de dívidas e o simplifica para minimizar o número de transferências Pix.

#### 1. Arestas brutas (`computeRawEdges`)

A partir dos dados de consumo e pagamento, gera uma aresta para cada par (consumidor, pagador). Se a conta teve taxa de serviço percentual, distribui proporcionalmente ao consumo. Taxa fixa é dividida igualmente.

**Exemplo simples** &mdash; 3 pessoas, 1 pagador:

```mermaid
graph LR
    A[Ana] -->|R$ 30| C[Carlos]
    B[Bia] -->|R$ 20| C
    A -->|R$ 15| B
```

**Exemplo com 5 pessoas e 2 pagadores** &mdash; jantar de R$ 300, Carlos pagou R$ 200 e Bia pagou R$ 100:

```mermaid
graph LR
    A[Ana] -->|R$ 40| C[Carlos]
    A -->|R$ 20| B[Bia]
    D[Dan] -->|R$ 50| C
    D -->|R$ 25| B
    E[Eva] -->|R$ 30| C
    E -->|R$ 15| B
    B -->|R$ 27| C
```

7 arestas. Vários intermediários. Vamos simplificar.

#### 2. Cancelamento de pares reversos

Quando A deve pra B e B deve pra A, compensa automaticamente. Sobra apenas o saldo líquido.

No exemplo acima, Bia recebe de Ana (R$ 20), Dan (R$ 25) e Eva (R$ 15), mas deve R$ 27 pra Carlos.

```mermaid
graph LR
    A[Ana] -->|R$ 40| C[Carlos]
    D[Dan] -->|R$ 50| C
    E[Eva] -->|R$ 30| C
    A -->|R$ 20| B[Bia]
    D -->|R$ 25| B
    E -->|R$ 15| B
```

Bia não deve mais nada a Carlos depois da compensação (R$ 27 absorvido pelo que ela recebe).

#### 3. Colapso de cadeias

Se A deve pra B e B deve pra C, remove o intermediário: A paga direto pra C.

*Ana &rarr; Bia &rarr; Carlos vira Ana &rarr; Carlos*

Bia vira passthrough &mdash; o que ela recebe dos outros cobre o que ela deve pro Carlos.

#### 4. Minimização por saldo líquido (`netAndMinimize`)

Calcula o saldo final de cada participante e pareia devedores com credores usando um algoritmo guloso ordenado por valor decrescente.

```
Saldos:  Ana = -60   Dan = -75   Eva = -45   Bia = +33   Carlos = +147
```

Resultado otimizado &mdash; de 7 arestas pra 4:

```mermaid
graph LR
    D[Dan] -->|R$ 75| C[Carlos]
    A[Ana] -->|R$ 60| C
    E[Eva] -->|R$ 12| C
    E -->|R$ 33| B[Bia]
```

O resultado final é o conjunto mínimo de transferências Pix necessárias. Cada passo é registrado em `SimplificationStep` para a visualização paginada no app.

Cada participante pode gerar um QR Code Pix para pagar sua parte direto.

### Segurança

- Chaves Pix **criptografadas em repouso** (AES-256-GCM) e **descriptografadas apenas no servidor**
- Row-Level Security em todas as tabelas do Supabase
- Descoberta de usuários apenas por **@handle exato** &mdash; sem busca ou enumeração
- Geração de QR exige co-participação autenticada na conta

## Comandos

```bash
npm run dev              # Servidor de desenvolvimento
npm run build            # Build de produção
npm run lint             # ESLint
npm run test             # Testes unitários
npm run test:integration # Testes de integração
```

### Android

```bash
npx cap sync android                  # Sincronizar projeto Android
npm run cap:assets                    # Gerar ícones e splash screens
cd android && ./gradlew assembleDebug # Build debug APK
```

## Convenções

- Todo dinheiro é **centavos inteiros** &mdash; nunca ponto flutuante
- Todo texto visível ao usuário é **português (pt-BR)**
- Supabase usa `gen_random_uuid()`, não `uuid_generate_v4()`

## Licença

Privado. Todos os direitos reservados.
