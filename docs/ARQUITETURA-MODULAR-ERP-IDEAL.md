# Arquitetura Modular do ERP Ideal

## Objetivo

Organizar o ERP Ideal por módulos para facilitar manutenção, evolução e leitura do código, mantendo `Next.js`, `React`, `TypeScript` e `Supabase` como base do projeto.

## Estrutura atual

- `src/app` é usada apenas para rotas e cascas finas.
- `src/features` é o dono dos módulos do ERP.
- `src/constants/navigation.ts` é a fonte oficial de `navigationItems`.
- `src/lib/navigation.ts` existe apenas como reexport temporário.

## Módulos já padronizados

- `Orçamentos`
- `Cadastros`
- `Contas a Receber`
- `Cobranças` / `Conferência de pagamentos`

## Fontes de dados importantes

- `Contas a Receber` usa `public.boletos` como fonte principal.
- `Cobranças` / `Conferência de pagamentos` usa `public.pagamentos_v2` como fonte principal.

## Regras de segurança

- Não mexer em `Auth`, `RLS`, `schema`, `migrations`, `policies`, `env` ou `Supabase client` sem confirmação explícita.
- Não fazer escrita real no Supabase sem confirmação explícita.

## Como pedir futuras alterações ao Cursor

- Informar o módulo alvo e o objetivo da mudança.
- Pedir primeiro o plano quando a alteração for maior ou envolver mais de uma camada.
- Pedir para mexer no menor número possível de arquivos quando a alteração for pequena.
- Reforçar sempre se a mudança pode ou não tocar em Supabase, Auth, RLS ou schema.

## Lint conhecido e pré-existente

- `src/features/cobrancas/hooks/useDashboardFinanceiroSnapshot.ts`
- `src/features/cobrancas/CobrancasList.tsx`
- `src/features/contas-a-receber/ContasReceberPage.tsx`



## Inteligência (Maestro)

- O Maestro atual opera na arquitetura **V2**.
- O núcleo baseia-se em um **Router Semântico** acoplado a **tools seguras**.
- A abordagem antiga (Maestro Simple) via regex/intents agora é considerada **legado** ou usada estritamente para comandos mínimos e diretos.
- **Orçamentos** continua como próxima etapa de implementação, e ainda não está integrado ao Maestro V2.
