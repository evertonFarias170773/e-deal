# Expedição — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `/expedicao` no centro de controle logístico do ERP: painel com funil produção→entrega, alertas de urgência, ações de despacho, etiquetas térmicas 10×15, prepostagem/rótulo oficial dos Correios e rastreio via n8n — 100% dados reais.

**Architecture:** O status oficial permanece em `propostas.status_interno` (fluxo `EXPEDICAO → A RETIRAR | EM TRANSITO → ENTREGUE`); os dados de execução logística ficam na tabela nova `public.expedicoes` (1 linha por `id_int`); transições logam em `public.os_status_log`. A tela é uma projeção client-side sobre `propostas` + `propostas_os` + `cotacao_frete` + `notas_fiscais` + `expedicoes` + `clientes`, no padrão visual de `PedidosListPage` (componentes `PageHeader`/`SummaryCard`/`StatusBadge`/`ResponsiveList` + filtros na URL). PDFs por rotas API `nodejs` com `@react-pdf/renderer` (padrão `imprimir-os`).

**Tech Stack:** Next.js (App Router), React, TypeScript, TailwindCSS, Supabase (client browser + `@/lib/supabase/server` nas rotas), `@react-pdf/renderer@^4`, `qrcode`, API Correios CWS, webhook n8n.

**Spec:** `docs/superpowers/specs/2026-08-15-expedicao-design.md`

## Global Constraints

- **PT-BR** em todo texto de UI, comentários e docs (AGENTS.md).
- **NUNCA commitar/pushar neste plano.** O AGENTS.md manda acumular o estado local e publicar TUDO só quando o dono pedir "publica". Os passos de validação substituem os commits.
- **Validação por task:** `npx tsc --noEmit` (zero erros) e `npx eslint <arquivos alterados>` (zero erros novos) + o teste objetivo indicado.
- **Sem test-runner unitário no repo** (só Playwright e2e; não adicionar framework). Funções puras são validadas por script temporário em `scratch/` (gitignored) + validação manual no app.
- **Não inventar colunas**: os selects usam exatamente os campos listados; PostgREST falha silencioso em coluna inexistente (é o bug atual da tela).
- Banco de produção: mudanças de schema APENAS via `mcp__supabase-prod__apply_migration` com o SQL idêntico ao arquivo em `supabase/migrations/`.
- Segredos só em `.env.local` (nunca commitado); o dono replica na Vercel.
- `id_int` é a chave de ligação universal; não criar identificadores paralelos.
- A branch é `erp-ideal-preview` na árvore principal — sem branch nova, sem worktree.
- Datas "hoje/atrasado" comparam **date-only no fuso America/Sao_Paulo**.
- Dark mode: usar tokens (`var(--card)` etc.) e classes `dark:` como os componentes comuns; não escurecer `--primary`.

---

## FASE 1 — Painel (dados reais, funil, alertas, filtros)

### Task 1: Migration `expedicoes` + policy de INSERT no `os_status_log`

**Files:**
- Create: `supabase/migrations/20260815_expedicoes.sql`
- Modify: `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` (adicionar linhas — ver Step 4)

**Interfaces:**
- Produces: tabela `public.expedicoes` (colunas exatas abaixo — todos os services das Tasks 4, 8, 10, 14, 16 dependem delas) e policy `os_status_log_insert_authenticated` (Task 8 insere no log direto do client).

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260815_expedicoes.sql` com exatamente:

```sql
-- expedicoes — dados de EXECUÇÃO da expedição (1 linha por pedido/id_int)
--
-- O QUE E
--   O que o expedidor grava ao operar: peso aferido do pacote, volumes,
--   transportadora definida na hora, rastreio, prepostagem dos Correios e as
--   datas de pronto/despacho/entrega.
--
-- POR QUE
--   O status oficial do pedido continua em propostas.status_interno (fluxo
--   EXPEDICAO -> A RETIRAR | EM TRANSITO -> ENTREGUE, doc
--   FLUXO-OFICIAL-STATUS-PROPOSTAS.md secao 6.13). Mas nao havia onde gravar a
--   execucao: propostas.peso e smallint (estoura em ~32kg), cotacao_frete e
--   historico de cotacao (nao deve ser mutado) e propostas_os so tem o rastreio.
--   O rastreio continua espelhado em propostas_os.codigo_rastreamento para as
--   telas legadas.
--
-- OS_STATUS_LOG
--   A tabela ja existia com RLS ligado e ZERO policies: so as RPCs SECURITY
--   DEFINER do QR publico conseguiam escrever. A Expedicao do ERP registra as
--   transicoes direto (origem='EXPEDICAO_UI'), entao ganha policy de INSERT
--   para authenticated. Sem SELECT/UPDATE/DELETE: trilha de auditoria e
--   escrita-e-esquecida do lado do client.
--
-- ROLLBACK
--   drop policy if exists os_status_log_insert_authenticated on public.os_status_log;
--   drop table if exists public.expedicoes;

create table if not exists public.expedicoes (
  id bigint generated always as identity primary key,
  id_int integer not null unique,
  -- Categoria normalizada definida no despacho:
  -- CORREIOS | MOTOBOY | TRANSPORTADORA | RETIRA_BALCAO | SEM_CUSTO | INDEFINIDO
  tipo_frete text,
  transportadora_nome text,
  id_transportadora_cliente integer references public.clientes (id_cliente),
  peso_kg numeric,
  qtd_volumes integer,
  tipo_volume text,
  id_endereco_entrega uuid references public.enderecos (id),
  codigo_rastreamento text,
  correios_id_prepostagem text,
  correios_codigo_objeto text,
  data_pronto timestamptz,
  data_despacho timestamptz,
  data_entrega timestamptz,
  despachado_por text,
  retirado_por text,
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expedicoes_tipo_frete_check check (
    tipo_frete is null or tipo_frete in
      ('CORREIOS','MOTOBOY','TRANSPORTADORA','RETIRA_BALCAO','SEM_CUSTO','INDEFINIDO')
  ),
  constraint expedicoes_tipo_volume_check check (
    tipo_volume is null or tipo_volume in ('Pacote','Caixa','Envelope','Outro')
  )
);

comment on table public.expedicoes is
  'Execucao da expedicao (1 linha por id_int): peso aferido, volumes, transportadora definida, rastreio, prepostagem Correios e datas. Status oficial permanece em propostas.status_interno.';
comment on column public.expedicoes.peso_kg is
  'Peso aferido na expedicao, em KG (cotacao_frete.peso e em gramas).';

alter table public.expedicoes enable row level security;

-- Mesmo alcance das telas internas (padrao de propostas_os_setores): usuario
-- autenticado. Sem policy anon e sem DELETE (linha de expedicao nao se apaga).
drop policy if exists expedicoes_select_authenticated on public.expedicoes;
create policy expedicoes_select_authenticated
  on public.expedicoes for select to authenticated using (true);

drop policy if exists expedicoes_insert_authenticated on public.expedicoes;
create policy expedicoes_insert_authenticated
  on public.expedicoes for insert to authenticated with check (id_int is not null);

drop policy if exists expedicoes_update_authenticated on public.expedicoes;
create policy expedicoes_update_authenticated
  on public.expedicoes for update to authenticated
  using (id_int is not null) with check (id_int is not null);

-- Trilha de transicoes: a Expedicao do ERP escreve direto no log.
drop policy if exists os_status_log_insert_authenticated on public.os_status_log;
create policy os_status_log_insert_authenticated
  on public.os_status_log for insert to authenticated with check (id_int is not null);
```

- [ ] **Step 2: Aplicar no banco**

Aplicar via MCP: `mcp__supabase-prod__apply_migration` com `name: "20260815_expedicoes"` e o SQL acima (idêntico ao arquivo).

- [ ] **Step 3: Verificar aplicação (somente leitura)**

Via `mcp__supabase-prod__execute_sql`:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='expedicoes') AS colunas_expedicoes,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='expedicoes') AS policies_expedicoes,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='os_status_log' AND cmd='INSERT') AS insert_policy_log;
```

Esperado: `colunas_expedicoes = 20`, `policies_expedicoes = 3`, `insert_policy_log = 1`.

- [ ] **Step 4: Atualizar a matriz de segurança**

Em `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`, adicionar na tabela de permissões (mesmo formato das linhas existentes):

```
| public.expedicoes | INSERT/UPDATE | LIBERADO (authenticated) | Execucao da expedicao: peso, volumes, transportadora, rastreio, prepostagem Correios, datas. DELETE bloqueado (sem policy). |
| public.os_status_log | INSERT | LIBERADO (authenticated) | Trilha de transicoes da Expedicao (origem='EXPEDICAO_UI'). SELECT/UPDATE/DELETE seguem bloqueados. |
| public.propostas.status_interno | UPDATE | LIBERADO via Expedicao | Transicoes EXPEDICAO -> A RETIRAR | EM TRANSITO -> ENTREGUE com guarda de concorrencia (WHERE status_interno = esperado) e log em os_status_log. |
```

- [ ] **Step 5: Validar**

Run: `npx tsc --noEmit` — esperado: sem erros (nada de TS mudou; sanidade).

---

### Task 2: Apagar o mock morto de Expedição em `features/pedidos`

**Files:**
- Delete: `src/features/pedidos/ExpedicaoPage.tsx`
- Modify: `src/features/pedidos/index.ts` (remover a linha 8: `export * from "./ExpedicaoPage";` — conferir o texto exato antes)

**Interfaces:**
- Consumes: nada.
- Produces: nada (remoção). A única `ExpedicaoPage` do projeto passa a ser a de `src/features/expedicao/`.

- [ ] **Step 1: Confirmar que ninguém importa o arquivo**

Run: `npx eslint --no-eslintrc --help >NUL 2>&1` (ignorar) — na prática use Grep: procurar `from "@/features/pedidos/ExpedicaoPage"` e `pedidos/ExpedicaoPage` em `src/`. Esperado: nenhuma ocorrência fora do próprio `src/features/pedidos/index.ts`.

- [ ] **Step 2: Apagar arquivo e export**

Deletar `src/features/pedidos/ExpedicaoPage.tsx`; remover do `src/features/pedidos/index.ts` a linha `export * from "./ExpedicaoPage";`.

- [ ] **Step 3: Validar**

Run: `npx tsc --noEmit`
Esperado: sem erros. Se aparecer erro de import quebrado, o Step 1 falhou — reverter e investigar o importador.

---

### Task 3: Tipos novos + normalizador de tipo de frete

**Files:**
- Rewrite: `src/features/expedicao/types.ts`
- Create: `src/features/expedicao/lib/tipo-frete.ts`
- Create: `scratch/checar-tipo-frete.mjs` (verificação descartável; `scratch/` é gitignored)

**Interfaces:**
- Produces (Tasks 4, 6, 8, 10 e 14 consomem):
  - `TipoFreteNormalizado`, `EtapaExpedicao`, `NfStatusExpedicao`, `ExpedicaoRegistro`, `PedidoExpedicao` (em `types.ts`)
  - `normalizarTipoFrete(servico: string | null | undefined): TipoFreteNormalizado`
  - `labelTipoFrete(tipo: TipoFreteNormalizado): string`
  - `TIPOS_FRETE: TipoFreteNormalizado[]` (ordem do select de filtro)

- [ ] **Step 1: Reescrever `src/features/expedicao/types.ts`**

Substituir TODO o conteúdo por:

```ts
/** Categorias canônicas derivadas do texto livre de cotacao_frete.servico. */
export type TipoFreteNormalizado =
  | "CORREIOS"
  | "MOTOBOY"
  | "TRANSPORTADORA"
  | "RETIRA_BALCAO"
  | "SEM_CUSTO"
  | "INDEFINIDO";

/** Etapa do funil logístico, derivada de propostas.status_interno. */
export type EtapaExpedicao =
  | "PRODUCAO"
  | "ACABAMENTO"
  | "PRONTO"
  | "A_RETIRAR"
  | "EM_TRANSITO"
  | "ENTREGUE";

export type NfStatusExpedicao = "AUTORIZADA" | "PENDENTE" | "SEM_NF";

/** Linha de public.expedicoes (execução da expedição), em camelCase. */
export interface ExpedicaoRegistro {
  idInt: number;
  tipoFrete: TipoFreteNormalizado | null;
  transportadoraNome: string | null;
  idTransportadoraCliente: number | null;
  pesoKg: number | null;
  qtdVolumes: number | null;
  tipoVolume: string | null;
  idEnderecoEntrega: string | null;
  codigoRastreamento: string | null;
  correiosIdPrepostagem: string | null;
  correiosCodigoObjeto: string | null;
  dataPronto: string | null;
  dataDespacho: string | null;
  dataEntrega: string | null;
  despachadoPor: string | null;
  retiradoPor: string | null;
  obs: string | null;
}

/** Item do painel de Expedição (projeção sobre 6 tabelas — ver expedicao.service). */
export interface PedidoExpedicao {
  idInt: number;
  cliente: string;
  idCliente: number | null;
  cidadeUf: string;
  empresa: string;
  statusInterno: string;
  etapa: EtapaExpedicao;
  /** propostas_os.data_termino (ISO) — a promessa exibida. */
  dataPromessa: string | null;
  /** Dias de atraso (0 = em dia). Só conta para etapa != ENTREGUE. */
  atrasadoDias: number;
  prometidoHoje: boolean;
  /** expedicoes.tipo_frete (definido no despacho) > normalização da cotação. */
  tipoFrete: TipoFreteNormalizado;
  /** Texto cru do serviço cotado (ex: "SEDEX", "FRETE INCLUSO"). */
  freteServico: string;
  /** Nome resolvido: expedicoes.transportadora_nome > cotação. */
  transportadoraNome: string;
  freteValor: number | null;
  pesoKg: number | null;
  pesoOrigem: "aferido" | "cotado" | "teorico" | null;
  volumes: number | null;
  nfStatus: NfStatusExpedicao;
  nfNumero: string | null;
  liberaNf: boolean;
  codigoRastreamento: string;
  obsOs: string;
  expedicao: ExpedicaoRegistro | null;
}
```

- [ ] **Step 2: Criar `src/features/expedicao/lib/tipo-frete.ts`**

```ts
import type { TipoFreteNormalizado } from "../types";

/** Ordem de exibição no select de filtro da tela. */
export const TIPOS_FRETE: TipoFreteNormalizado[] = [
  "CORREIOS",
  "MOTOBOY",
  "TRANSPORTADORA",
  "RETIRA_BALCAO",
  "SEM_CUSTO",
  "INDEFINIDO"
];

const LABELS: Record<TipoFreteNormalizado, string> = {
  CORREIOS: "Correios",
  MOTOBOY: "Motoboy",
  TRANSPORTADORA: "Transportadora",
  RETIRA_BALCAO: "Retira balcão",
  SEM_CUSTO: "Sem custo",
  INDEFINIDO: "A definir"
};

export function labelTipoFrete(tipo: TipoFreteNormalizado): string {
  return LABELS[tipo];
}

/**
 * Normaliza o texto LIVRE de cotacao_frete.servico nas categorias canônicas.
 * Vocabulário levantado do banco em 15/08/2026: SEDEX(490), FRETE INCLUSO(1077),
 * SEM CUSTO(97), MOTOBOY(69), SÃO MIGUEL(28), AZUL ECOMM/ECOMM/AZUL(34),
 * VEPPO/VEPPO-RS(23), RETIRA*(25), UNESUL(5), BRASPRESS/BRASPESS(3), TROCA(2),
 * TRANSPORTADORA PARCEIRA(5) e lixo ("12", "AS", "DD", "NÃO", "FRETE"...).
 * "RETIRA" antes de "TRANSPORTADORA"; acentos são removidos antes do match.
 * IMPORTANTE: "SEM CUSTO" é envio grátis, NÃO retirada (corrige a heurística
 * antiga da tela, que jogava SEM CUSTO em retirada local).
 */
export function normalizarTipoFrete(
  servico: string | null | undefined
): TipoFreteNormalizado {
  const s = (servico ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!s) return "INDEFINIDO";
  if (/(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)/.test(s)) return "CORREIOS";
  if (s.includes("MOTOBOY")) return "MOTOBOY";
  if (s.includes("RETIRA") || s.includes("BALCAO")) return "RETIRA_BALCAO";
  if (s.includes("SEM CUSTO")) return "SEM_CUSTO";
  if (
    s.includes("SAO MIGUEL") ||
    s.includes("UNESUL") ||
    s.includes("BRASPRESS") ||
    s.includes("BRASPESS") ||
    s.includes("AZUL") ||
    s.includes("ECOMM") ||
    s.includes("VEPPO") ||
    s.includes("TROCA") ||
    s.includes("TRANSPORTADORA")
  ) {
    return "TRANSPORTADORA";
  }
  return "INDEFINIDO";
}
```

- [ ] **Step 3: Verificação descartável do normalizador**

O repo não tem test-runner nem `tsx`, então a verificação roda em Node puro com uma CÓPIA literal da função (descartável; a fonte da verdade é o `.ts` — se editar a função depois, re-copiar antes de re-rodar). Criar `scratch/checar-tipo-frete.mjs`:

```js
// Cópia literal de normalizarTipoFrete (src/features/expedicao/lib/tipo-frete.ts)
// sem as anotações de tipo — colar o corpo atual da função aqui:
function normalizarTipoFrete(servico) {
  const s = (servico ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
  if (!s) return "INDEFINIDO";
  if (/(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)/.test(s)) return "CORREIOS";
  if (s.includes("MOTOBOY")) return "MOTOBOY";
  if (s.includes("RETIRA") || s.includes("BALCAO")) return "RETIRA_BALCAO";
  if (s.includes("SEM CUSTO")) return "SEM_CUSTO";
  if (
    s.includes("SAO MIGUEL") || s.includes("UNESUL") || s.includes("BRASPRESS") ||
    s.includes("BRASPESS") || s.includes("AZUL") || s.includes("ECOMM") ||
    s.includes("VEPPO") || s.includes("TROCA") || s.includes("TRANSPORTADORA")
  ) return "TRANSPORTADORA";
  return "INDEFINIDO";
}

// Casos reais do banco (15/08/2026) + rótulos do mapper de cotação:
const casos = [
  ["SEDEX", "CORREIOS"],
  ["Correios SEDEX", "CORREIOS"],
  ["FRETE INCLUSO", "INDEFINIDO"],
  ["SEM CUSTO", "SEM_CUSTO"],
  ["MOTOBOY ", "MOTOBOY"],
  ["SÃO MIGUEL ", "TRANSPORTADORA"],
  ["EXPRESSO SÃO MIGUEL", "TRANSPORTADORA"],
  ["AZUL ECOMM", "TRANSPORTADORA"],
  ["ECOMM", "TRANSPORTADORA"],
  ["VEPPO-RS", "TRANSPORTADORA"],
  ["BRASPESS", "TRANSPORTADORA"],
  ["TROCA TRANSPORTES", "TRANSPORTADORA"],
  ["TRANSPORTADORA PARCEIRA", "TRANSPORTADORA"],
  ["RETIRA BALCÃO", "RETIRA_BALCAO"],
  ["RETIRA NO BALCÃO", "RETIRA_BALCAO"],
  ["RETIRADA LOCAL", "RETIRA_BALCAO"],
  ["ACOMPANHA OUTRO PEDIDO", "INDEFINIDO"],
  ["12", "INDEFINIDO"],
  ["", "INDEFINIDO"],
  [null, "INDEFINIDO"]
];
let falhas = 0;
for (const [entrada, esperado] of casos) {
  const obtido = normalizarTipoFrete(entrada);
  if (obtido !== esperado) {
    console.error(`FALHOU: normalizarTipoFrete(${JSON.stringify(entrada)}) => ${obtido}, esperado ${esperado}`);
    falhas++;
  }
}
console.log(falhas === 0 ? `OK: ${casos.length} casos` : `${falhas} falhas`);
process.exitCode = falhas === 0 ? 0 : 1;
```

Run: `node scratch/checar-tipo-frete.mjs`
Esperado: `OK: 20 casos`, exit 0.

- [ ] **Step 4: Validar**

Run: `npx tsc --noEmit` — a reescrita de `types.ts` VAI quebrar `expedicao.service.ts` e `ExpedicaoPage.tsx` antigos (usam `ExpedicaoListItem`/`FreteInfo` removidos). Esperado NESTA task: erros APENAS nesses dois arquivos (serão reescritos nas Tasks 4 e 6). Se aparecer erro em qualquer outro arquivo, investigar antes de seguir.

Nota de sequência: Tasks 3→4→6 formam a reescrita; o `tsc` só volta a zerar no fim da Task 6. Executor: rodar as três em sequência sem intercalar outras.

---

### Task 4: Service novo — `listarPainelExpedicao`

**Files:**
- Rewrite: `src/features/expedicao/services/expedicao.service.ts`

**Interfaces:**
- Consumes: `PedidoExpedicao`, `ExpedicaoRegistro`, `EtapaExpedicao`, `NfStatusExpedicao` (Task 3); `normalizarTipoFrete` (Task 3); `getSupabaseClient` de `@/lib/supabase/client`.
- Produces (Task 6 e Fase 2 consomem):
  - `listarPainelExpedicao(): Promise<PedidoExpedicao[]>`
  - `STATUS_FUNIL_EXPEDICAO: string[]` (lista exata de status consultados)
  - `hojeSaoPaulo(): string` (data "YYYY-MM-DD" no fuso America/Sao_Paulo)

- [ ] **Step 1: Reescrever o service**

Substituir TODO o conteúdo de `src/features/expedicao/services/expedicao.service.ts` por:

```ts
import { getSupabaseClient } from "@/lib/supabase/client";
import { normalizarTipoFrete } from "../lib/tipo-frete";
import type {
  EtapaExpedicao,
  ExpedicaoRegistro,
  NfStatusExpedicao,
  PedidoExpedicao,
  TipoFreteNormalizado
} from "../types";

/**
 * Universo do painel: tudo que está aprovado para produção (is_prd_aprovado)
 * do APROVADO até a entrega. EXPEDICAO em diante é o fluxo oficial da doc
 * FLUXO-OFICIAL-STATUS-PROPOSTAS.md §6.13.
 */
export const STATUS_FUNIL_EXPEDICAO = [
  "APROVADO",
  "LIBERADO",
  "REVISAO ATENDENTE",
  "REVISAO PRODUCAO",
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO",
  "EM ACABAMENTO / PENDENTE",
  "EXPEDICAO",
  "A RETIRAR",
  "EM TRANSITO",
  "ENTREGUE"
];

const STATUS_PRODUCAO = new Set([
  "APROVADO",
  "LIBERADO",
  "REVISAO ATENDENTE",
  "REVISAO PRODUCAO",
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE"
]);

/** Entregues somem do painel depois de 30 dias (expedicoes.data_entrega). */
const DIAS_ENTREGUE_VISIVEL = 30;

export function hojeSaoPaulo(): string {
  // en-CA formata como YYYY-MM-DD, comparável por string.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function etapaDoStatus(status: string): EtapaExpedicao {
  if (status === "EXPEDICAO") return "PRONTO";
  if (status === "A RETIRAR") return "A_RETIRAR";
  if (status === "EM TRANSITO") return "EM_TRANSITO";
  if (status === "ENTREGUE") return "ENTREGUE";
  if (status.startsWith("EM ACABAMENTO")) return "ACABAMENTO";
  return "PRODUCAO";
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
function diffDias(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export async function listarPainelExpedicao(): Promise<PedidoExpedicao[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[expedicao.service] Supabase client não inicializado.");
    return [];
  }

  // 1. Propostas do funil
  const { data: propostas, error: propError } = await client
    .from("propostas")
    .select("id_int, cliente, id_cliente, empresa, status_interno, libera_nf, volume, cep, valor_frete")
    .eq("is_prd_aprovado", true)
    .in("status_interno", STATUS_FUNIL_EXPEDICAO)
    .order("id_int", { ascending: false });

  if (propError || !propostas) {
    console.error("[expedicao.service] Erro ao buscar propostas:", propError);
    return [];
  }
  if (propostas.length === 0) return [];

  const ids = propostas.map((p) => Number(p.id_int));
  const idsCliente = Array.from(
    new Set(propostas.map((p) => Number(p.id_cliente)).filter((n) => Number.isFinite(n) && n > 0))
  );

  // 2..6 em paralelo — cada bloco é tolerante a falha individual (warn + vazio),
  // MENOS cotacao_frete, cujo erro é logado com destaque (foi o bug da tela antiga).
  const [osRes, fretesRes, nfsRes, expRes, clientesRes, pesosRes] = await Promise.all([
    client
      .from("propostas_os")
      .select("id_int, data_termino, codigo_rastreamento, obs")
      .in("id_int", ids),
    client
      .from("cotacao_frete")
      .select("id_int, servico, valor, prazo, peso, cep")
      .eq("escolhido", true)
      .in("id_int", ids),
    client
      .from("notas_fiscais")
      .select("id_int, status, numero_nf")
      .in("id_int", ids),
    client
      .from("expedicoes")
      .select(
        "id_int, tipo_frete, transportadora_nome, id_transportadora_cliente, peso_kg, qtd_volumes, tipo_volume, id_endereco_entrega, codigo_rastreamento, correios_id_prepostagem, correios_codigo_objeto, data_pronto, data_despacho, data_entrega, despachado_por, retirado_por, obs"
      )
      .in("id_int", ids),
    idsCliente.length > 0
      ? client.from("clientes").select("id_cliente, nome, fantasia, cidade_uf").in("id_cliente", idsCliente)
      : Promise.resolve({ data: [], error: null } as const),
    client.from("produtos_proposta").select("id_int, peso_total").in("id_int", ids)
  ]);

  if (fretesRes.error) {
    console.error("[expedicao.service] Erro ao buscar cotacao_frete (frete ficará 'A definir'):", fretesRes.error);
  }
  for (const [nome, res] of [
    ["propostas_os", osRes],
    ["notas_fiscais", nfsRes],
    ["expedicoes", expRes],
    ["clientes", clientesRes],
    ["produtos_proposta", pesosRes]
  ] as const) {
    if (res.error) console.warn(`[expedicao.service] Erro ao buscar ${nome}:`, res.error);
  }

  const osMap = new Map<number, { data_termino: string | null; codigo_rastreamento: string | null; obs: string | null }>();
  for (const row of osRes.data ?? []) {
    if (row.id_int !== null) osMap.set(Number(row.id_int), row);
  }

  const freteMap = new Map<number, { servico: string | null; valor: number | null; prazo: string | null; peso: number | null; cep: string | null }>();
  for (const row of fretesRes.data ?? []) freteMap.set(Number(row.id_int), row);

  // NF: AUTORIZADA vence; senão qualquer nota não-cancelada conta como PENDENTE.
  const nfMap = new Map<number, { status: NfStatusExpedicao; numero: string | null }>();
  for (const row of nfsRes.data ?? []) {
    const idInt = Number(row.id_int);
    const st = String(row.status ?? "").toUpperCase();
    const atual = nfMap.get(idInt);
    if (st === "AUTORIZADA") {
      nfMap.set(idInt, { status: "AUTORIZADA", numero: row.numero_nf ? String(row.numero_nf) : null });
    } else if (st !== "CANCELADA" && atual?.status !== "AUTORIZADA") {
      nfMap.set(idInt, { status: "PENDENTE", numero: row.numero_nf ? String(row.numero_nf) : null });
    }
  }

  const expMap = new Map<number, ExpedicaoRegistro>();
  for (const row of expRes.data ?? []) {
    expMap.set(Number(row.id_int), {
      idInt: Number(row.id_int),
      tipoFrete: (row.tipo_frete as TipoFreteNormalizado | null) ?? null,
      transportadoraNome: row.transportadora_nome ?? null,
      idTransportadoraCliente: row.id_transportadora_cliente !== null ? Number(row.id_transportadora_cliente) : null,
      pesoKg: row.peso_kg !== null ? Number(row.peso_kg) : null,
      qtdVolumes: row.qtd_volumes !== null ? Number(row.qtd_volumes) : null,
      tipoVolume: row.tipo_volume ?? null,
      idEnderecoEntrega: row.id_endereco_entrega ?? null,
      codigoRastreamento: row.codigo_rastreamento ?? null,
      correiosIdPrepostagem: row.correios_id_prepostagem ?? null,
      correiosCodigoObjeto: row.correios_codigo_objeto ?? null,
      dataPronto: row.data_pronto ?? null,
      dataDespacho: row.data_despacho ?? null,
      dataEntrega: row.data_entrega ?? null,
      despachadoPor: row.despachado_por ?? null,
      retiradoPor: row.retirado_por ?? null,
      obs: row.obs ?? null
    });
  }

  const clienteMap = new Map<number, { nome: string | null; fantasia: string | null; cidade_uf: string | null }>();
  for (const row of clientesRes.data ?? []) clienteMap.set(Number(row.id_cliente), row);

  const pesoTeoricoGramas = new Map<number, number>();
  for (const row of pesosRes.data ?? []) {
    const idInt = Number(row.id_int);
    const g = Number(row.peso_total) || 0;
    pesoTeoricoGramas.set(idInt, (pesoTeoricoGramas.get(idInt) ?? 0) + g);
  }

  const hoje = hojeSaoPaulo();
  const resultado: PedidoExpedicao[] = [];

  for (const p of propostas) {
    const idInt = Number(p.id_int);
    const statusInterno = String(p.status_interno ?? "");
    const etapa = etapaDoStatus(statusInterno);
    const os = osMap.get(idInt);
    const frete = freteMap.get(idInt);
    const exp = expMap.get(idInt) ?? null;
    const nf = nfMap.get(idInt);
    const idCliente = p.id_cliente !== null ? Number(p.id_cliente) : null;
    const cli = idCliente !== null ? clienteMap.get(idCliente) : undefined;

    // Entregue some do painel após 30 dias (sem data_entrega registrada, mantém).
    if (etapa === "ENTREGUE" && exp?.dataEntrega) {
      const dataEntregueDia = exp.dataEntrega.slice(0, 10);
      if (diffDias(dataEntregueDia, hoje) > DIAS_ENTREGUE_VISIVEL) continue;
    }

    const dataPromessa = os?.data_termino ?? null;
    const promessaDia = dataPromessa ? dataPromessa.slice(0, 10) : null;
    const emAberto = etapa !== "ENTREGUE";
    const atrasadoDias =
      emAberto && promessaDia && promessaDia < hoje ? diffDias(promessaDia, hoje) : 0;
    const prometidoHoje = emAberto && promessaDia === hoje;

    const tipoFrete: TipoFreteNormalizado = exp?.tipoFrete ?? normalizarTipoFrete(frete?.servico);

    let pesoKg: number | null = null;
    let pesoOrigem: PedidoExpedicao["pesoOrigem"] = null;
    if (exp?.pesoKg !== null && exp?.pesoKg !== undefined) {
      pesoKg = exp.pesoKg;
      pesoOrigem = "aferido";
    } else if (frete?.peso) {
      pesoKg = Number(frete.peso) / 1000;
      pesoOrigem = "cotado";
    } else if ((pesoTeoricoGramas.get(idInt) ?? 0) > 0) {
      pesoKg = (pesoTeoricoGramas.get(idInt) as number) / 1000;
      pesoOrigem = "teorico";
    }

    resultado.push({
      idInt,
      cliente: p.cliente || cli?.nome || cli?.fantasia || `Proposta #${idInt}`,
      idCliente,
      cidadeUf: cli?.cidade_uf ?? "",
      empresa: p.empresa || "",
      statusInterno,
      etapa,
      dataPromessa,
      atrasadoDias,
      prometidoHoje,
      tipoFrete,
      freteServico: frete?.servico ?? "",
      transportadoraNome: exp?.transportadoraNome || frete?.servico || "",
      freteValor: frete?.valor !== null && frete?.valor !== undefined ? Number(frete.valor) : null,
      pesoKg,
      pesoOrigem,
      volumes: exp?.qtdVolumes ?? (p.volume !== null ? Number(p.volume) : null),
      nfStatus: nf?.status ?? "SEM_NF",
      nfNumero: nf?.numero ?? null,
      liberaNf: p.libera_nf === true,
      codigoRastreamento: exp?.codigoRastreamento || os?.codigo_rastreamento || "",
      obsOs: os?.obs ?? "",
      expedicao: exp
    });
  }

  // Urgência primeiro: atrasados (mais atrasado no topo) → prometidos hoje →
  // demais por promessa mais próxima; sem promessa vai para o fim de cada grupo.
  resultado.sort((a, b) => {
    if (a.atrasadoDias !== b.atrasadoDias) return b.atrasadoDias - a.atrasadoDias;
    if (a.prometidoHoje !== b.prometidoHoje) return a.prometidoHoje ? -1 : 1;
    const pa = a.dataPromessa ?? "9999-12-31";
    const pb = b.dataPromessa ?? "9999-12-31";
    if (pa !== pb) return pa < pb ? -1 : 1;
    return b.idInt - a.idInt;
  });

  return resultado;
}

/** Marcador usado pelo StatusBadge: STATUS_PRODUCAO não ganha ação de despacho. */
export function etapaEhProducao(etapa: EtapaExpedicao): boolean {
  return etapa === "PRODUCAO" || etapa === "ACABAMENTO";
}

export { STATUS_PRODUCAO };
```

- [ ] **Step 2: Validar tipos**

Run: `npx tsc --noEmit`
Esperado: erros restantes APENAS em `src/features/expedicao/ExpedicaoPage.tsx` (a tela antiga, reescrita na Task 6). Qualquer outro arquivo com erro = bug desta task.

- [ ] **Step 3: Conferir a consulta contra o banco (somente leitura)**

Via `mcp__supabase-prod__execute_sql`, validar que a lista terá itens e os joins têm dados:

```sql
SELECT count(*) AS funil FROM propostas
WHERE is_prd_aprovado = true AND status_interno IN
('APROVADO','LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO','EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE','EXPEDICAO','A RETIRAR','EM TRANSITO','ENTREGUE');
```

Esperado: mesmo total que a UI mostrará (7 em 15/08/2026; anotar o número do dia para comparar na Task 6).

---

### Task 5: `StatusBadge` + `humanizeStatus` com os status logísticos

**Files:**
- Modify: `src/components/common/StatusBadge.tsx` (mapa `toneByStatus`)
- Modify: `src/lib/formatters/status.ts` (mapa `statusMap` dentro de `humanizeStatus`)

**Interfaces:**
- Produces: `<StatusBadge status="EXPEDICAO" />` etc. renderizam com tom e rótulo certos (Task 6 usa sem passar `tone`).

- [ ] **Step 1: Adicionar tons em `StatusBadge.tsx`**

No objeto `toneByStatus` (após a linha `EXPEDIDO: "success",`), adicionar:

```ts
  // Status logísticos oficiais (propostas.status_interno) — chaves com espaço.
  EXPEDICAO: "warning",
  "A RETIRAR": "special",
  "EM TRANSITO": "info",
  ENTREGUE: "success",
```

- [ ] **Step 2: Adicionar rótulos em `humanizeStatus`**

Em `src/lib/formatters/status.ts`, dentro do `statusMap` (após `EXPEDIDO: "Expedido",`), adicionar:

```ts
    EXPEDICAO: "Na Expedição",
    "A RETIRAR": "A Retirar",
    "EM TRANSITO": "Em Trânsito",
    ENTREGUE: "Entregue",
```

Antes de editar, conferir o fallback do `humanizeStatus` (fim da função): se já devolve o texto cru para chaves ausentes, os rótulos acima ainda valem por causa da capitalização/acentos.

- [ ] **Step 3: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/components/common/StatusBadge.tsx src/lib/formatters/status.ts`
Esperado: sem erros novos (os erros pré-existentes da ExpedicaoPage antiga persistem até a Task 6).

---

### Task 6: Reescrever a tela `ExpedicaoPage` (painel completo)

**Files:**
- Rewrite: `src/features/expedicao/ExpedicaoPage.tsx`

**Interfaces:**
- Consumes: `listarPainelExpedicao`, `PedidoExpedicao`, `EtapaExpedicao`, `TipoFreteNormalizado` (Tasks 3–4); `labelTipoFrete`, `TIPOS_FRETE` (Task 3); componentes comuns (`PageHeader`, `SummaryCard`, `StatusBadge`, `ResponsiveList`, `EmptyState`); `useAuth` + `hasPermissao`; `useUrlFilters`/`codecs`/`useDebouncedInput`.
- Produces: a página completa da Fase 1 (somente leitura; as ações chegam na Fase 2). Expõe internamente `recarregar()` e o estado `pedidos` que a Fase 2 reutiliza.

- [ ] **Step 1: Reescrever o componente**

Substituir TODO o conteúdo de `src/features/expedicao/ExpedicaoPage.tsx` por:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bike,
  CheckCircle2,
  Clock,
  Copy,
  Factory,
  MapPin,
  Package,
  PackageCheck,
  Search,
  Send,
  Truck
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SummaryCard } from "@/components/common/SummaryCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { EmptyState } from "@/components/common/EmptyState";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { listarPainelExpedicao } from "./services/expedicao.service";
import { labelTipoFrete, TIPOS_FRETE } from "./lib/tipo-frete";
import type { EtapaExpedicao, PedidoExpedicao, TipoFreteNormalizado } from "./types";

const filterClass =
  "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

type AlertaFiltro = "TODOS" | "ATRASADOS" | "HOJE" | "SEM_NF" | "FRETE_INDEFINIDO";

const ICONE_TIPO_FRETE: Record<TipoFreteNormalizado, typeof Truck> = {
  CORREIOS: Send,
  MOTOBOY: Bike,
  TRANSPORTADORA: Truck,
  RETIRA_BALCAO: MapPin,
  SEM_CUSTO: Package,
  INDEFINIDO: AlertCircle
};

function formatarPromessa(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatarPeso(p: PedidoExpedicao): string {
  if (p.pesoKg === null) return "—";
  const kg = p.pesoKg.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const sufixo = p.pesoOrigem === "aferido" ? "" : p.pesoOrigem === "cotado" ? " (cotado)" : " (previsto)";
  return `${kg} kg${sufixo}`;
}

export function ExpedicaoPage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const [pedidos, setPedidos] = useState<PedidoExpedicao[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const canView = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.view");

  // Filtros na URL — padrão docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      etapa: { codec: codecs.texto(), default: "ATIVOS" },
      alerta: { codec: codecs.texto(), default: "TODOS" },
      frete: { codec: codecs.texto(), default: "TODOS" },
      emp: { codec: codecs.texto(), default: "TODOS" }
    }),
    []
  );
  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema);
  const [search, setSearch] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  async function recarregar() {
    const data = await listarPainelExpedicao();
    setPedidos(data);
    setIsLoaded(true);
  }

  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- contagens (sobre o conjunto todo, não o filtrado: cards são atalhos) ----
  const porEtapa = useMemo(() => {
    const contar = (etapas: EtapaExpedicao[]) => pedidos.filter((p) => etapas.includes(p.etapa)).length;
    return {
      producao: contar(["PRODUCAO"]),
      acabamento: contar(["ACABAMENTO"]),
      pronto: contar(["PRONTO"]),
      aRetirar: contar(["A_RETIRAR"]),
      emTransito: contar(["EM_TRANSITO"]),
      entregues: contar(["ENTREGUE"])
    };
  }, [pedidos]);

  const alertas = useMemo(() => {
    const abertos = pedidos.filter((p) => p.etapa !== "ENTREGUE");
    return {
      atrasados: abertos.filter((p) => p.atrasadoDias > 0).length,
      hoje: abertos.filter((p) => p.prometidoHoje).length,
      // Sem NF só alerta do PRONTO em diante — em produção ainda é normal não ter nota.
      semNf: pedidos.filter(
        (p) => ["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA"
      ).length,
      freteIndefinido: abertos.filter((p) => p.tipoFrete === "INDEFINIDO").length
    };
  }, [pedidos]);

  // ---- filtragem em memória ----
  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filters.etapa === "ATIVOS" && p.etapa === "ENTREGUE") return false;
      if (filters.etapa !== "ATIVOS" && filters.etapa !== "TODAS" && p.etapa !== filters.etapa) return false;

      if (filters.alerta === "ATRASADOS" && !(p.atrasadoDias > 0 && p.etapa !== "ENTREGUE")) return false;
      if (filters.alerta === "HOJE" && !p.prometidoHoje) return false;
      if (
        filters.alerta === "SEM_NF" &&
        !(["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA")
      )
        return false;
      if (filters.alerta === "FRETE_INDEFINIDO" && !(p.tipoFrete === "INDEFINIDO" && p.etapa !== "ENTREGUE"))
        return false;

      if (filters.frete !== "TODOS" && p.tipoFrete !== filters.frete) return false;
      if (
        filters.emp !== "TODOS" &&
        p.empresa.toLowerCase().replace(/\s/g, "") !== filters.emp.toLowerCase().replace(/\s/g, "")
      )
        return false;

      if (q === "") return true;
      return (
        String(p.idInt).includes(q) ||
        p.cliente.toLowerCase().includes(q) ||
        p.codigoRastreamento.toLowerCase().includes(q) ||
        p.transportadoraNome.toLowerCase().includes(q)
      );
    });
  }, [pedidos, filters, search]);

  // Entregues ordenados por entrega mais recente quando o card Entregues está ativo.
  const listaExibida = useMemo(() => {
    if (filters.etapa !== "ENTREGUE") return filtrados;
    return [...filtrados].sort((a, b) =>
      (b.expedicao?.dataEntrega ?? "").localeCompare(a.expedicao?.dataEntrega ?? "")
    );
  }, [filtrados, filters.etapa]);

  const empresaOptions = useMemo(
    () => Array.from(new Set(pedidos.map((p) => p.empresa))).filter(Boolean).sort(),
    [pedidos]
  );

  function toggleEtapa(etapa: string) {
    setFilter("etapa", filters.etapa === etapa ? "ATIVOS" : etapa);
  }
  function toggleAlerta(alerta: AlertaFiltro) {
    setFilter("alerta", filters.alerta === alerta ? "TODOS" : alerta);
  }

  async function copiarRastreio(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      showToast({ type: "success", title: "Rastreio copiado", description: codigo });
    } catch {
      showToast({ type: "error", title: "Não foi possível copiar", description: codigo });
    }
  }

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title="Acesso Negado"
          description="Você não tem permissão para visualizar a Expedição."
          icon={AlertCircle}
        />
      </div>
    );
  }

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition";

  return (
    <div className="space-y-6 font-sans">
      {/* Navegação cruzada com a Fila Geral — mantida da tela anterior */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-200/50 bg-white p-2.5 text-xs shadow-sm dark:border-slate-800/40 dark:bg-slate-900">
        <Link
          href="/pedidos"
          className="rounded-xl px-3.5 py-2 font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Voltar para Fila Geral (OS)
        </Link>
        <div className="rounded-xl bg-[#0b2f4a] px-3.5 py-2 font-bold text-white">Expedição e Logística</div>
      </div>

      <PageHeader
        title="Expedição"
        subtitle="Do acabamento à entrega: prontos, retiradas, trânsito e alertas de urgência."
        context="Logística"
        action={null}
      />

      {/* Cards do funil (clicáveis = filtro de etapa) */}
      {isLoaded && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <SummaryCard
            title="Em produção"
            value={porEtapa.producao.toString()}
            description="Antes do acabamento"
            tone="neutral"
            icon={Factory}
            onClick={() => toggleEtapa("PRODUCAO")}
          />
          <SummaryCard
            title="Em acabamento"
            value={porEtapa.acabamento.toString()}
            description="Chegando na bancada"
            tone="info"
            icon={Clock}
            onClick={() => toggleEtapa("ACABAMENTO")}
          />
          <SummaryCard
            title="Pronto p/ expedir"
            value={porEtapa.pronto.toString()}
            description="Aguardando despacho"
            tone="warning"
            icon={PackageCheck}
            onClick={() => toggleEtapa("PRONTO")}
          />
          <SummaryCard
            title="A retirar"
            value={porEtapa.aRetirar.toString()}
            description="Cliente busca no balcão"
            tone="special"
            icon={MapPin}
            onClick={() => toggleEtapa("A_RETIRAR")}
          />
          <SummaryCard
            title="Em trânsito"
            value={porEtapa.emTransito.toString()}
            description="Com a transportadora"
            tone="info"
            icon={Truck}
            onClick={() => toggleEtapa("EM_TRANSITO")}
          />
          <SummaryCard
            title="Entregues"
            value={porEtapa.entregues.toString()}
            description="Últimos 30 dias"
            tone="success"
            icon={CheckCircle2}
            onClick={() => toggleEtapa("ENTREGUE")}
          />
        </section>
      )}

      {/* Chips de alerta */}
      {isLoaded && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => toggleAlerta("ATRASADOS")}
            className={`${chipBase} ${
              filters.alerta === "ATRASADOS"
                ? "border-red-600 bg-red-600 text-white"
                : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5" /> Atrasados ({alertas.atrasados})
          </button>
          <button
            type="button"
            onClick={() => toggleAlerta("HOJE")}
            className={`${chipBase} ${
              filters.alerta === "HOJE"
                ? "border-amber-500 bg-amber-500 text-white"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
            }`}
          >
            <Clock className="h-3.5 w-3.5" /> Prometidos hoje ({alertas.hoje})
          </button>
          <button
            type="button"
            onClick={() => toggleAlerta("SEM_NF")}
            className={`${chipBase} ${
              filters.alerta === "SEM_NF"
                ? "border-rose-600 bg-rose-600 text-white"
                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
            }`}
          >
            Sem NF ({alertas.semNf})
          </button>
          <button
            type="button"
            onClick={() => toggleAlerta("FRETE_INDEFINIDO")}
            className={`${chipBase} ${
              filters.alerta === "FRETE_INDEFINIDO"
                ? "border-slate-700 bg-slate-700 text-white"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            Frete a definir ({alertas.freteIndefinido})
          </button>
          {(filters.etapa !== "ATIVOS" || filters.alerta !== "TODOS") && (
            <button
              type="button"
              onClick={() => setFilters({ etapa: "ATIVOS", alerta: "TODOS" })}
              className={`${chipBase} border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400`}
            >
              Ver funil ativo
            </button>
          )}
        </div>
      )}

      {/* Busca e filtros */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 xl:grid-cols-[1fr_220px_220px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
              placeholder="Buscar por nº, cliente, rastreio ou transportadora..."
            />
          </label>

          <select value={filters.frete} onChange={(e) => setFilter("frete", e.target.value)} className={filterClass}>
            <option value="TODOS">Todos os fretes</option>
            {TIPOS_FRETE.map((tipo) => (
              <option key={tipo} value={tipo}>
                {labelTipoFrete(tipo)}
              </option>
            ))}
          </select>

          <select value={filters.emp} onChange={(e) => setFilter("emp", e.target.value)} className={filterClass}>
            <option value="TODOS">Todas Empresas</option>
            {empresaOptions.map((option) => (
              <option key={option} value={option.toLowerCase().replace(/\s/g, "")}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setFilters({ q: "", etapa: "ATIVOS", alerta: "TODOS", frete: "TODOS", emp: "TODOS" });
              setSearch("");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<PedidoExpedicao>
        items={listaExibida}
        getKey={(p) => p.idInt.toString()}
        isLoading={!isLoaded}
        emptyTitle="Nenhum pedido no recorte"
        emptyDescription="Ajuste os filtros ou confira se há pedidos aprovados para produção."
        getRowHighlight={(p) =>
          p.atrasadoDias > 0 && p.etapa !== "ENTREGUE"
            ? { base: "rgba(239,68,68,0.08)", hover: "rgba(239,68,68,0.15)" }
            : p.prometidoHoje
              ? { base: "rgba(245,158,11,0.10)", hover: "rgba(245,158,11,0.17)" }
              : null
        }
        columns={[
          {
            header: "Pedido",
            cell: (p) => (
              <div className="flex flex-col">
                <span className="font-semibold text-slate-950 dark:text-slate-100">#{p.idInt}</span>
                <span className="text-[11px] text-slate-500">{p.empresa}</span>
              </div>
            )
          },
          {
            header: "Cliente",
            cell: (p) => (
              <div className="flex max-w-[190px] flex-col">
                <span className="truncate font-medium text-slate-900 dark:text-slate-100" title={p.cliente}>
                  {p.cliente}
                </span>
                {p.cidadeUf && <span className="text-[11px] text-slate-500">{p.cidadeUf}</span>}
              </div>
            )
          },
          {
            header: "Status",
            cell: (p) => <StatusBadge status={p.statusInterno} />
          },
          {
            header: "Promessa",
            cell: (p) => {
              const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
              return (
                <div className="flex flex-col gap-1">
                  <span
                    className={`text-sm font-semibold ${
                      ehAtrasado ? "text-red-600" : p.prometidoHoje ? "text-amber-600" : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {formatarPromessa(p.dataPromessa)}
                  </span>
                  {ehAtrasado && (
                    <span className="inline-flex w-fit items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">
                      ATRASADO {p.atrasadoDias}d
                    </span>
                  )}
                  {p.prometidoHoje && (
                    <span className="inline-flex w-fit items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white">
                      HOJE
                    </span>
                  )}
                </div>
              );
            }
          },
          {
            header: "Frete",
            cell: (p) => {
              const Icone = ICONE_TIPO_FRETE[p.tipoFrete];
              return (
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <Icone className="h-3.5 w-3.5 shrink-0" />
                    {p.tipoFrete === "INDEFINIDO" ? "A definir" : p.transportadoraNome || labelTipoFrete(p.tipoFrete)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatarPeso(p)}
                    {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                  </span>
                </div>
              );
            }
          },
          {
            header: "NF",
            cell: (p) =>
              p.nfStatus === "AUTORIZADA" ? (
                <StatusBadge status="AUTORIZADA" />
              ) : p.nfStatus === "PENDENTE" ? (
                <StatusBadge status="PENDENTE" />
              ) : ["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                  SEM NF
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )
          },
          {
            header: "Rastreio",
            cell: (p) =>
              p.codigoRastreamento ? (
                <button
                  type="button"
                  onClick={() => void copiarRastreio(p.codigoRastreamento)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  title="Copiar código"
                >
                  {p.codigoRastreamento}
                  <Copy className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-xs italic text-slate-400">—</span>
              )
          },
          {
            header: "Ações",
            align: "right",
            // Fase 2 substitui por botão contextual + ActionsMenu (Task 9).
            cell: (p) => <span className="text-xs text-slate-400">#{p.idInt}</span>
          }
        ]}
        renderCard={(p) => {
          const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
          const Icone = ICONE_TIPO_FRETE[p.tipoFrete];
          return (
            <article
              key={p.idInt}
              className={`rounded-3xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
                ehAtrasado
                  ? "border-red-300 dark:border-red-900"
                  : p.prometidoHoje
                    ? "border-amber-300 dark:border-amber-900"
                    : "border-[#d7e5e8] dark:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    #{p.idInt} · {p.empresa}
                  </p>
                  <h3 className="mt-1 font-semibold text-slate-950 dark:text-slate-100">{p.cliente}</h3>
                  {p.cidadeUf && <p className="text-xs text-slate-500">{p.cidadeUf}</p>}
                </div>
                <StatusBadge status={p.statusInterno} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {ehAtrasado && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 font-black text-white">
                    ATRASADO {p.atrasadoDias}d
                  </span>
                )}
                {p.prometidoHoje && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 font-black text-white">HOJE</span>
                )}
                {["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA" && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold text-red-700">
                    SEM NF
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <p className="inline-flex items-center gap-1.5">
                  <Icone className="h-3.5 w-3.5" />
                  {p.tipoFrete === "INDEFINIDO" ? "Frete a definir" : p.transportadoraNome || labelTipoFrete(p.tipoFrete)}
                </p>
                <p>
                  Promessa: <strong>{formatarPromessa(p.dataPromessa)}</strong>
                </p>
                <p>
                  {formatarPeso(p)}
                  {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                </p>
                {p.codigoRastreamento && (
                  <button
                    type="button"
                    onClick={() => void copiarRastreio(p.codigoRastreamento)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {p.codigoRastreamento}
                    <Copy className="h-3 w-3" />
                  </button>
                )}
              </div>
            </article>
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Validar compilação**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/`
Esperado: **zero erros no projeto inteiro** (Tasks 3+4+6 fecham a reescrita).

- [ ] **Step 3: Validar no app com dados reais**

Run: `npm run dev` e abrir `http://localhost:3000/expedicao`. Roteiro:
1. Os 6 cards aparecem e a soma de (Em produção + Em acabamento + Pronto + A retirar + Em trânsito) = total do SQL da Task 4 Step 3 (entregues ficam fora da visão padrão).
2. Nenhum item mostra "A definir" indevidamente: pedidos com cotação SEDEX aparecem como Correios (bug antigo do SEM FRETE corrigido).
3. Chip "Atrasados" com contagem coerente com `data_termino < hoje`.
4. Buscar por um `id_int` existente filtra a lista; F5 preserva filtros (URL).
5. Clicar num card filtra por etapa; clicar de novo volta ao funil ativo.
6. Modo mobile (largura < 1024px): cards renderizam.

---

### Task 7: Guard de permissão já embutido + entrada de navegação

A Task 6 já embute o `canView` (padrão `PedidosListPage`). Esta task só confere a navegação e cria as permissões nomeadas.

**Files:**
- Verify: `src/constants/navigation.ts` (entrada `/expedicao` já existe e sem `disabled`)
- Verify: existência das permissões `expedicao.view` / `expedicao.operar` no cadastro de perfis (tela de perfis ou tabela `perfis`)

**Interfaces:**
- Produces: convenção de permissões usada pelo restante do plano: `expedicao.view` (ver painel) e `expedicao.operar` (transições/despacho/etiquetas — usada a partir da Task 9).

- [ ] **Step 1: Conferir navegação**

Grep `expedicao` em `src/constants/navigation.ts` — esperado: links existentes em duas listas (desktop/mobile), sem `disabled: true`. Nada a mudar; se houver `disabled`, remover.

- [ ] **Step 2: Registrar permissões nos perfis (dado, não código)**

Via `mcp__supabase-prod__execute_sql` (leitura): `SELECT id, nome, permissoes FROM perfis WHERE ativo = true;`
- Se os perfis usam wildcard `*` (admins), nada a fazer.
- Para perfis operacionais que devem acessar a Expedição, ANOTAR no resultado da task que o dono precisa adicionar `expedicao.view`/`expedicao.operar` na tela de perfis (não alterar dados de permissão por SQL sem o dono pedir).

- [ ] **Step 3: Validar**

Com um usuário admin em localhost, `/expedicao` abre; a lógica `hasPermissao` cai no fallback admin quando o perfil não tem as chaves (comportamento herdado do padrão da Fila Geral).

---

## FASE 2 — Ações do expedidor

### Task 8: Service de ações — transições + upsert de `expedicoes`

**Files:**
- Create: `src/features/expedicao/services/expedicao-acoes.service.ts`

**Interfaces:**
- Consumes: tabela `expedicoes` (Task 1), `TipoFreteNormalizado` (Task 3), `getSupabaseClient`.
- Produces (Tasks 9–13 consomem — assinaturas exatas):
  - `type AtorExpedicao = { uid: string | null; nome: string | null }`
  - `type ResultadoAcao = { success: boolean; error?: string }`
  - `type DespachoInput = { tipoEntrega: "TRANSPORTE" | "RETIRADA"; tipoFrete: TipoFreteNormalizado; transportadoraNome: string; idTransportadoraCliente: number | null; pesoKg: number | null; qtdVolumes: number | null; tipoVolume: string | null; idEnderecoEntrega: string | null; codigoRastreamento: string; obs: string }`
  - `marcarPronto(idInt: number, statusAtual: string, ator: AtorExpedicao): Promise<ResultadoAcao>`
  - `despachar(idInt: number, input: DespachoInput, ator: AtorExpedicao): Promise<ResultadoAcao>`
  - `confirmarRetirada(idInt: number, retiradoPor: string, ator: AtorExpedicao): Promise<ResultadoAcao>`
  - `marcarEntregue(idInt: number, ator: AtorExpedicao): Promise<ResultadoAcao>`
  - `voltarStatus(idInt: number, statusAtual: string, motivo: string, ator: AtorExpedicao): Promise<ResultadoAcao>`
  - `salvarDadosExpedicao(idInt: number, dados: Partial<Omit<DespachoInput, "tipoEntrega">>): Promise<ResultadoAcao>`

- [ ] **Step 1: Criar o service**

Criar `src/features/expedicao/services/expedicao-acoes.service.ts`:

```ts
import { getSupabaseClient } from "@/lib/supabase/client";
import type { TipoFreteNormalizado } from "../types";

export type AtorExpedicao = { uid: string | null; nome: string | null };
export type ResultadoAcao = { success: boolean; error?: string };

export type DespachoInput = {
  tipoEntrega: "TRANSPORTE" | "RETIRADA";
  tipoFrete: TipoFreteNormalizado;
  transportadoraNome: string;
  idTransportadoraCliente: number | null;
  pesoKg: number | null;
  qtdVolumes: number | null;
  tipoVolume: string | null;
  idEnderecoEntrega: string | null;
  codigoRastreamento: string;
  obs: string;
};

const MSG_CONFLITO =
  "O pedido mudou de status em outra tela. A lista será recarregada.";

/**
 * Atualiza propostas.status_interno COM guarda de concorrência:
 * o UPDATE só acontece se o status ainda for o que a tela viu.
 */
async function transicionar(
  idInt: number,
  statusEsperado: string,
  statusNovo: string,
  ator: AtorExpedicao,
  motivo: string | null,
  tipoTransicao: "NATURAL" | "RETORNO"
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  const { data, error } = await client
    .from("propostas")
    .update({ status_interno: statusNovo })
    .eq("id_int", idInt)
    .eq("status_interno", statusEsperado)
    .select("id_int");

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: MSG_CONFLITO };

  // Trilha de auditoria — mesma tabela do QR de produção. Falha no log NÃO
  // desfaz a transição: loga warn e segue (trilha é observabilidade).
  const { error: logError } = await client.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: statusEsperado,
    status_novo: statusNovo,
    resultado: "OK",
    motivo,
    origem: "EXPEDICAO_UI",
    ator_tipo: "USUARIO",
    ator_uid: ator.uid,
    ator_nome: ator.nome,
    tipo_transicao: tipoTransicao
  });
  if (logError) console.warn("[expedicao-acoes] Falha ao gravar os_status_log:", logError);

  return { success: true };
}

/** Upsert em expedicoes por id_int (linha nasce no primeiro gesto do expedidor). */
async function upsertExpedicao(
  idInt: number,
  campos: Record<string, unknown>
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { error } = await client
    .from("expedicoes")
    .upsert({ id_int: idInt, updated_at: new Date().toISOString(), ...campos }, { onConflict: "id_int" });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Produção/acabamento → EXPEDICAO ("chegou na bancada"). */
export async function marcarPronto(
  idInt: number,
  statusAtual: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, statusAtual, "EXPEDICAO", ator, null, "NATURAL");
  if (!t.success) return t;
  return upsertExpedicao(idInt, { data_pronto: new Date().toISOString() });
}

/** EXPEDICAO → EM TRANSITO (transporte) ou A RETIRAR (retirada). */
export async function despachar(
  idInt: number,
  input: DespachoInput,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  const up = await upsertExpedicao(idInt, {
    tipo_frete: input.tipoFrete,
    transportadora_nome: input.transportadoraNome || null,
    id_transportadora_cliente: input.idTransportadoraCliente,
    peso_kg: input.pesoKg,
    qtd_volumes: input.qtdVolumes,
    tipo_volume: input.tipoVolume,
    id_endereco_entrega: input.idEnderecoEntrega,
    codigo_rastreamento: input.codigoRastreamento || null,
    obs: input.obs || null,
    data_despacho: new Date().toISOString(),
    despachado_por: ator.nome
  });
  if (!up.success) return up;

  // Espelho para as telas legadas que leem o rastreio na OS.
  if (input.codigoRastreamento) {
    const { error: osError } = await client
      .from("propostas_os")
      .update({ codigo_rastreamento: input.codigoRastreamento })
      .eq("id_int", idInt);
    if (osError) console.warn("[expedicao-acoes] Falha ao espelhar rastreio na OS:", osError);
  }

  const destino = input.tipoEntrega === "RETIRADA" ? "A RETIRAR" : "EM TRANSITO";
  return transicionar(idInt, "EXPEDICAO", destino, ator, null, "NATURAL");
}

/** A RETIRAR → ENTREGUE (quem retirou fica registrado). */
export async function confirmarRetirada(
  idInt: number,
  retiradoPor: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, "A RETIRAR", "ENTREGUE", ator, null, "NATURAL");
  if (!t.success) return t;
  return upsertExpedicao(idInt, {
    data_entrega: new Date().toISOString(),
    retirado_por: retiradoPor || null
  });
}

/** EM TRANSITO → ENTREGUE. */
export async function marcarEntregue(idInt: number, ator: AtorExpedicao): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, "EM TRANSITO", "ENTREGUE", ator, null, "NATURAL");
  if (!t.success) return t;
  return upsertExpedicao(idInt, { data_entrega: new Date().toISOString() });
}

/**
 * Desfaz exatamente 1 passo. Destinos:
 *  ENTREGUE → EM TRANSITO se o despacho foi transporte; senão A RETIRAR;
 *  EM TRANSITO | A RETIRAR → EXPEDICAO;
 *  EXPEDICAO → EM ACABAMENTO.
 */
export async function voltarStatus(
  idInt: number,
  statusAtual: string,
  motivo: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  let destino: string;
  if (statusAtual === "ENTREGUE") {
    const { data } = await client
      .from("expedicoes")
      .select("tipo_frete, retirado_por")
      .eq("id_int", idInt)
      .maybeSingle();
    const foiRetirada = data?.tipo_frete === "RETIRA_BALCAO" || Boolean(data?.retirado_por);
    destino = foiRetirada ? "A RETIRAR" : "EM TRANSITO";
  } else if (statusAtual === "EM TRANSITO" || statusAtual === "A RETIRAR") {
    destino = "EXPEDICAO";
  } else if (statusAtual === "EXPEDICAO") {
    destino = "EM ACABAMENTO";
  } else {
    return { success: false, error: `Não há retorno definido a partir de "${statusAtual}".` };
  }

  const t = await transicionar(idInt, statusAtual, destino, ator, motivo || null, "RETORNO");
  if (!t.success) return t;

  // Limpa a data correspondente ao passo desfeito.
  if (statusAtual === "ENTREGUE") return upsertExpedicao(idInt, { data_entrega: null, retirado_por: null });
  if (statusAtual === "EM TRANSITO" || statusAtual === "A RETIRAR")
    return upsertExpedicao(idInt, { data_despacho: null });
  return upsertExpedicao(idInt, { data_pronto: null });
}

/** Edita dados de execução sem mexer no status. */
export async function salvarDadosExpedicao(
  idInt: number,
  dados: Partial<Omit<DespachoInput, "tipoEntrega">>
): Promise<ResultadoAcao> {
  const campos: Record<string, unknown> = {};
  if (dados.tipoFrete !== undefined) campos.tipo_frete = dados.tipoFrete;
  if (dados.transportadoraNome !== undefined) campos.transportadora_nome = dados.transportadoraNome || null;
  if (dados.idTransportadoraCliente !== undefined) campos.id_transportadora_cliente = dados.idTransportadoraCliente;
  if (dados.pesoKg !== undefined) campos.peso_kg = dados.pesoKg;
  if (dados.qtdVolumes !== undefined) campos.qtd_volumes = dados.qtdVolumes;
  if (dados.tipoVolume !== undefined) campos.tipo_volume = dados.tipoVolume;
  if (dados.idEnderecoEntrega !== undefined) campos.id_endereco_entrega = dados.idEnderecoEntrega;
  if (dados.codigoRastreamento !== undefined) campos.codigo_rastreamento = dados.codigoRastreamento || null;
  if (dados.obs !== undefined) campos.obs = dados.obs || null;
  return upsertExpedicao(idInt, campos);
}
```

- [ ] **Step 2: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/services/expedicao-acoes.service.ts`
Esperado: zero erros.

- [ ] **Step 3: Teste de fumaça no banco (reversível)**

Em localhost (após a Task 9 ligar os botões) OU direto via SQL: escolher 1 `id_int` real em produção com status `EM ACABAMENTO` e, via UI da Task 9, marcar pronto → conferir com `mcp__supabase-prod__execute_sql`:

```sql
SELECT p.status_interno, e.data_pronto,
       (SELECT count(*) FROM os_status_log l WHERE l.id_int = p.id_int AND l.origem = 'EXPEDICAO_UI') AS logs
FROM propostas p LEFT JOIN expedicoes e ON e.id_int = p.id_int
WHERE p.id_int = <ID_ESCOLHIDO>;
```

Esperado: `EXPEDICAO`, `data_pronto` preenchida, `logs = 1`. Reverter em seguida pela UI ("Voltar status") e conferir `logs = 2` com `tipo_transicao = 'RETORNO'`.

---

### Task 9: Ações na lista — botão contextual + menu ⋯

**Files:**
- Modify: `src/features/expedicao/ExpedicaoPage.tsx` (coluna "Ações", card mobile e wiring dos modais das Tasks 10–13)

**Interfaces:**
- Consumes: `marcarPronto`, `voltarStatus`, `marcarEntregue`, `AtorExpedicao` (Task 8); `ActionsMenu` de `@/components/common/ActionsMenu`; modais das Tasks 10–13 (`DespacharModal`, `RetiradaModal`, `VoltarStatusModal`, `TransportadorasModal`, `RastreioModal`).
- Produces: handlers `abrirDespacho(p)`, `abrirRetirada(p)`, `abrirRastreio(p)`, `abrirVoltar(p)` e `atorAtual(): AtorExpedicao` usados pelos modais.

Nota de execução: esta task é feita EM CONJUNTO com as Tasks 10–13 (os modais). Ordem recomendada: 10 → 11 → 12 → 13 → 9 (a 9 liga tudo). O plano descreve a 9 primeiro porque define os pontos de encaixe.

- [ ] **Step 1: Estado e helpers no componente**

Dentro de `ExpedicaoPage`, após `const [isLoaded, setIsLoaded] = useState(false);`, adicionar:

```tsx
  const canOperar = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.operar");
  const [pedidoDespacho, setPedidoDespacho] = useState<PedidoExpedicao | null>(null);
  const [pedidoRetirada, setPedidoRetirada] = useState<PedidoExpedicao | null>(null);
  const [pedidoVoltar, setPedidoVoltar] = useState<PedidoExpedicao | null>(null);
  const [pedidoRastreio, setPedidoRastreio] = useState<PedidoExpedicao | null>(null);
  const [transportadorasAberto, setTransportadorasAberto] = useState(false);
  const [salvandoAcao, setSalvandoAcao] = useState<number | null>(null);

  function atorAtual() {
    return {
      uid: user?.id ?? null,
      nome: user?.nome ?? user?.email ?? null
    };
  }
```

Se `MockUser` não tiver `id`/`nome`/`email` (o `tsc` acusa), usar os campos reais do tipo (`src/features/auth/usuarios.service.ts`) — o objetivo é uid do auth + um nome legível.

```tsx
  async function handleMarcarPronto(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    if (!window.confirm(`Marcar o pedido #${p.idInt} (${p.cliente}) como PRONTO para expedição?`)) return;
    setSalvandoAcao(p.idInt);
    const res = await marcarPronto(p.idInt, p.statusInterno, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Pedido pronto para expedir", description: `#${p.idInt} agora está na bancada da expedição.` });
    } else {
      showToast({ type: "error", title: "Não foi possível marcar pronto", description: res.error });
    }
    void recarregar();
  }

  async function handleMarcarEntregue(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    if (!window.confirm(`Confirmar ENTREGA do pedido #${p.idInt} (${p.cliente})?`)) return;
    setSalvandoAcao(p.idInt);
    const res = await marcarEntregue(p.idInt, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Pedido entregue", description: `#${p.idInt} concluído.` });
    } else {
      showToast({ type: "error", title: "Não foi possível concluir", description: res.error });
    }
    void recarregar();
  }
```

Imports novos no topo: `ActionsMenu` de `@/components/common/ActionsMenu`; `marcarPronto`, `marcarEntregue` de `./services/expedicao-acoes.service`; `useRouter` de `next/navigation`; os modais (`./components/DespacharModal` etc., Tasks 10–13). Adicionar `const router = useRouter();`.

- [ ] **Step 2: Substituir a coluna "Ações"**

Trocar a célula placeholder da coluna "Ações" (Task 6) por:

```tsx
          {
            header: "Ações",
            align: "right",
            cell: (p) => {
              const ocupado = salvandoAcao === p.idInt;
              const primario =
                !canOperar ? null :
                p.etapa === "PRODUCAO" || p.etapa === "ACABAMENTO"
                  ? { rotulo: ocupado ? "Salvando..." : "Marcar pronto", acao: () => void handleMarcarPronto(p) }
                  : p.etapa === "PRONTO"
                    ? { rotulo: "Despachar", acao: () => setPedidoDespacho(p) }
                    : p.etapa === "A_RETIRAR"
                      ? { rotulo: "Confirmar retirada", acao: () => setPedidoRetirada(p) }
                      : p.etapa === "EM_TRANSITO"
                        ? { rotulo: ocupado ? "Salvando..." : "Marcar entregue", acao: () => void handleMarcarEntregue(p) }
                        : null;

              const acoesMenu = [
                ...(p.codigoRastreamento
                  ? [{ label: "Rastrear objeto", onClick: () => setPedidoRastreio(p) }]
                  : []),
                ...(canOperar && p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO"
                  ? [{ label: "Editar dados de expedição", onClick: () => setPedidoDespacho(p) }]
                  : []),
                { label: "Detalhes da proposta", onClick: () => router.push(`/orcamentos/${p.idInt}`) },
                ...(canOperar && p.etapa !== "PRODUCAO"
                  ? [{ label: "Voltar status", destructive: true, onClick: () => setPedidoVoltar(p) }]
                  : [])
              ];

              return (
                <div className="flex items-center justify-end gap-1.5">
                  {primario && (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={primario.acao}
                      className="rounded-2xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50"
                    >
                      {primario.rotulo}
                    </button>
                  )}
                  <ActionsMenu items={acoesMenu} />
                </div>
              );
            }
          }
```

Nota: "Editar dados de expedição" reaproveita o `DespacharModal` em modo edição (Task 10 — prop `modoEdicao`, sem transição de status).

- [ ] **Step 3: Botão primário também no card mobile**

No `renderCard`, antes do fechamento do `<article>`, adicionar o mesmo botão primário contextual (copiar o bloco `primario` para uma função compartilhada `acaoPrimaria(p)` no corpo do componente para não duplicar lógica) + `<ActionsMenu items={...}/>` idem.

- [ ] **Step 4: Header ganha o botão "Transportadoras"**

Trocar `action={null}` do `PageHeader` por:

```tsx
        action={
          <button
            type="button"
            onClick={() => setTransportadorasAberto(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Building2 className="h-4 w-4" /> Transportadoras
          </button>
        }
```

Adicionar `Building2` ao import do `lucide-react`. Se `PageHeader` tipar `action` de outra forma (conferir `src/components/common/PageHeader.tsx`), ajustar mantendo o botão.

- [ ] **Step 5: Renderizar os modais no fim do JSX**

Antes do `</div>` final:

```tsx
      {pedidoDespacho && (
        <DespacharModal
          pedido={pedidoDespacho}
          modoEdicao={pedidoDespacho.etapa !== "PRONTO"}
          ator={atorAtual()}
          onClose={() => setPedidoDespacho(null)}
          onDone={() => { setPedidoDespacho(null); void recarregar(); }}
        />
      )}
      {pedidoRetirada && (
        <RetiradaModal
          pedido={pedidoRetirada}
          ator={atorAtual()}
          onClose={() => setPedidoRetirada(null)}
          onDone={() => { setPedidoRetirada(null); void recarregar(); }}
        />
      )}
      {pedidoVoltar && (
        <VoltarStatusModal
          pedido={pedidoVoltar}
          ator={atorAtual()}
          onClose={() => setPedidoVoltar(null)}
          onDone={() => { setPedidoVoltar(null); void recarregar(); }}
        />
      )}
      {pedidoRastreio && (
        <RastreioModal pedido={pedidoRastreio} onClose={() => setPedidoRastreio(null)} onMarcarEntregue={() => { setPedidoRastreio(null); void handleMarcarEntregue(pedidoRastreio); }} />
      )}
      {transportadorasAberto && <TransportadorasModal onClose={() => setTransportadorasAberto(false)} />}
```

- [ ] **Step 6: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/`
Esperado: zero erros. Em localhost: pedido `EM ACABAMENTO` mostra "Marcar pronto"; após marcar, vira "Despachar"; executar o roteiro da Task 8 Step 3 (incluindo o "Voltar status" para desfazer o teste).

---

### Task 10: `DespacharModal` (o modal principal)

**Files:**
- Create: `src/features/expedicao/components/DespacharModal.tsx`
- Create: `src/features/expedicao/services/enderecos.service.ts`

**Interfaces:**
- Consumes: `despachar`, `salvarDadosExpedicao`, `DespachoInput`, `AtorExpedicao` (Task 8); `getTransportadoras` de `@/features/nfe/services/nfe.service` (conferir assinatura real em `nfe.service.ts:640` — retorna linhas `{ id_cliente, nome, fantasia, documento, cidade_uf }` de clientes `categoria='TRANSPORTADORA'` ativos); `labelTipoFrete`, `TIPOS_FRETE`, `normalizarTipoFrete` (Task 3).
- Produces:
  - `DespacharModal({ pedido, modoEdicao, ator, onClose, onDone }: { pedido: PedidoExpedicao; modoEdicao: boolean; ator: AtorExpedicao; onClose: () => void; onDone: () => void })`
  - `listarEnderecosCliente(idCliente: number): Promise<EnderecoCliente[]>` com `type EnderecoCliente = { id: string; rotulo: string; cep: string | null; recebedor: string | null }`

- [ ] **Step 1: Service de endereços**

Criar `src/features/expedicao/services/enderecos.service.ts`:

```ts
import { getSupabaseClient } from "@/lib/supabase/client";

export type EnderecoCliente = {
  id: string;
  /** "Rua X, 123 - Bairro, Cidade/UF (CEP 90000-000)" — pronto para o select. */
  rotulo: string;
  cep: string | null;
  recebedor: string | null;
};

export async function listarEnderecosCliente(idCliente: number): Promise<EnderecoCliente[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("enderecos")
    .select("id, endereco, numero, complemento, bairro, cidade, uf, cep, tipo_endereco, recebedor")
    .eq("id_cliente", idCliente)
    .order("data_criacao", { ascending: false });
  if (error || !data) {
    console.warn("[enderecos.service] Erro ao buscar endereços:", error);
    return [];
  }
  return data.map((e) => {
    const linha = [
      [e.endereco, e.numero].filter(Boolean).join(", "),
      e.complemento,
      e.bairro,
      [e.cidade, e.uf].filter(Boolean).join("/")
    ]
      .filter(Boolean)
      .join(" - ");
    const cep = e.cep ? String(e.cep) : null;
    const tipo = e.tipo_endereco ? ` [${e.tipo_endereco}]` : "";
    return {
      id: String(e.id),
      rotulo: `${linha}${cep ? ` (CEP ${cep})` : ""}${tipo}`,
      cep,
      recebedor: e.recebedor ? String(e.recebedor) : null
    };
  });
}
```

- [ ] **Step 2: O modal**

Criar `src/features/expedicao/components/DespacharModal.tsx` (padrão visual do `LiberarNfModal`: overlay `fixed inset-0 z-[70] bg-slate-950/50`, cartão `rounded-3xl bg-white`):

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";
import { labelTipoFrete, normalizarTipoFrete, TIPOS_FRETE } from "../lib/tipo-frete";
import { despachar, salvarDadosExpedicao } from "../services/expedicao-acoes.service";
import type { AtorExpedicao, DespachoInput } from "../services/expedicao-acoes.service";
import { listarEnderecosCliente } from "../services/enderecos.service";
import type { EnderecoCliente } from "../services/enderecos.service";
import type { PedidoExpedicao, TipoFreteNormalizado } from "../types";

const TIPOS_VOLUME = ["Pacote", "Caixa", "Envelope", "Outro"];

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1";

type Transportadora = { id_cliente: number; nome: string | null; fantasia: string | null };

export function DespacharModal({
  pedido,
  modoEdicao,
  ator,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  modoEdicao: boolean;
  ator: AtorExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const exp = pedido.expedicao;

  const tipoInicial: TipoFreteNormalizado = exp?.tipoFrete ?? pedido.tipoFrete;
  const [tipoFrete, setTipoFrete] = useState<TipoFreteNormalizado>(
    tipoInicial === "INDEFINIDO" ? "TRANSPORTADORA" : tipoInicial
  );
  const [tipoEntrega, setTipoEntrega] = useState<"TRANSPORTE" | "RETIRADA">(
    tipoInicial === "RETIRA_BALCAO" ? "RETIRADA" : "TRANSPORTE"
  );
  const [transportadoraNome, setTransportadoraNome] = useState(
    exp?.transportadoraNome ?? (pedido.tipoFrete === "INDEFINIDO" ? "" : pedido.transportadoraNome)
  );
  const [idTransportadoraCliente, setIdTransportadoraCliente] = useState<number | null>(
    exp?.idTransportadoraCliente ?? null
  );
  const [pesoKg, setPesoKg] = useState(exp?.pesoKg?.toString() ?? pedido.pesoKg?.toFixed(2) ?? "");
  const [qtdVolumes, setQtdVolumes] = useState(exp?.qtdVolumes?.toString() ?? pedido.volumes?.toString() ?? "1");
  const [tipoVolume, setTipoVolume] = useState(exp?.tipoVolume ?? "Pacote");
  const [codigoRastreamento, setCodigoRastreamento] = useState(pedido.codigoRastreamento);
  const [obs, setObs] = useState(exp?.obs ?? "");
  const [idEnderecoEntrega, setIdEnderecoEntrega] = useState<string | null>(exp?.idEnderecoEntrega ?? null);

  const [enderecos, setEnderecos] = useState<EnderecoCliente[]>([]);
  const [transportadoras, setTransportadoras] = useState<Transportadora[]>([]);
  const [confirmaSemNf, setConfirmaSemNf] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const precisaAvisoNf = !modoEdicao && pedido.nfStatus !== "AUTORIZADA";

  useEffect(() => {
    let ativo = true;
    if (pedido.idCliente !== null) {
      void listarEnderecosCliente(pedido.idCliente).then((lista) => {
        if (!ativo) return;
        setEnderecos(lista);
        // Default: endereço já salvo > primeiro da lista.
        if (!idEnderecoEntrega && lista.length > 0) setIdEnderecoEntrega(lista[0].id);
      });
    }
    void getTransportadoras().then((lista) => {
      if (ativo) setTransportadoras(lista as Transportadora[]);
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.idCliente]);

  const nomeExibicao = useMemo(
    () => (t: Transportadora) => t.fantasia || t.nome || `#${t.id_cliente}`,
    []
  );

  async function handleConfirmar() {
    if (salvando) return;
    if (precisaAvisoNf && !confirmaSemNf) {
      showToast({ type: "warning", title: "Confirme o despacho sem NF", description: "Marque a caixa de confirmação para despachar sem nota autorizada." });
      return;
    }
    const pesoNum = pesoKg.trim() === "" ? null : Number(pesoKg.replace(",", "."));
    if (pesoNum !== null && (!Number.isFinite(pesoNum) || pesoNum <= 0)) {
      showToast({ type: "error", title: "Peso inválido", description: "Informe o peso em kg (ex.: 12,4) ou deixe vazio." });
      return;
    }
    const volNum = qtdVolumes.trim() === "" ? null : Math.trunc(Number(qtdVolumes));
    if (volNum !== null && (!Number.isFinite(volNum) || volNum <= 0)) {
      showToast({ type: "error", title: "Volumes inválidos", description: "Quantidade de volumes precisa ser 1 ou mais." });
      return;
    }

    const input: DespachoInput = {
      tipoEntrega,
      tipoFrete: tipoEntrega === "RETIRADA" ? "RETIRA_BALCAO" : tipoFrete,
      transportadoraNome: tipoEntrega === "RETIRADA" ? "Retira balcão" : transportadoraNome.trim(),
      idTransportadoraCliente: tipoEntrega === "RETIRADA" ? null : idTransportadoraCliente,
      pesoKg: pesoNum,
      qtdVolumes: volNum,
      tipoVolume,
      idEnderecoEntrega,
      codigoRastreamento: codigoRastreamento.trim(),
      obs: obs.trim()
    };

    setSalvando(true);
    const res = modoEdicao
      ? await salvarDadosExpedicao(pedido.idInt, input)
      : await despachar(pedido.idInt, input, ator);
    setSalvando(false);

    if (res.success) {
      showToast({
        type: "success",
        title: modoEdicao ? "Dados de expedição salvos" : tipoEntrega === "RETIRADA" ? "Pedido aguardando retirada" : "Pedido despachado",
        description: `#${pedido.idInt} · ${pedido.cliente}`
      });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível salvar", description: res.error });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            {modoEdicao ? "Editar dados de expedição" : "Despachar pedido"} #{pedido.idInt}
          </h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {pedido.cliente}
            {pedido.cidadeUf ? ` · ${pedido.cidadeUf}` : ""} · frete cotado: {pedido.freteServico || "—"}
          </p>

          {!modoEdicao && (
            <div>
              <span className={labelClass}>Tipo de entrega</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTipoEntrega("TRANSPORTE")}
                  className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${tipoEntrega === "TRANSPORTE" ? "border-[#0b2f4a] bg-[#0b2f4a] text-white" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
                >
                  Transporte / envio
                </button>
                <button
                  type="button"
                  onClick={() => setTipoEntrega("RETIRADA")}
                  className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${tipoEntrega === "RETIRADA" ? "border-[#0b2f4a] bg-[#0b2f4a] text-white" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
                >
                  Retirada no balcão
                </button>
              </div>
            </div>
          )}

          {tipoEntrega === "TRANSPORTE" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Tipo de frete</label>
                  <select value={tipoFrete} onChange={(e) => setTipoFrete(e.target.value as TipoFreteNormalizado)} className={inputClass}>
                    {TIPOS_FRETE.filter((t) => t !== "RETIRA_BALCAO" && t !== "INDEFINIDO").map((t) => (
                      <option key={t} value={t}>{labelTipoFrete(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Transportadora cadastrada</label>
                  <select
                    value={idTransportadoraCliente ?? ""}
                    onChange={(e) => {
                      const id = e.target.value === "" ? null : Number(e.target.value);
                      setIdTransportadoraCliente(id);
                      const t = transportadoras.find((x) => x.id_cliente === id);
                      if (t) setTransportadoraNome(nomeExibicao(t));
                    }}
                    className={inputClass}
                  >
                    <option value="">— sem vínculo / digitar nome —</option>
                    {transportadoras.map((t) => (
                      <option key={t.id_cliente} value={t.id_cliente}>{nomeExibicao(t)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Nome da transportadora / serviço</label>
                <input value={transportadoraNome} onChange={(e) => setTransportadoraNome(e.target.value)} placeholder='Ex.: "Expresso São Miguel", "SEDEX"' className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Endereço de entrega (vai para a etiqueta)</label>
                <select value={idEnderecoEntrega ?? ""} onChange={(e) => setIdEnderecoEntrega(e.target.value === "" ? null : e.target.value)} className={inputClass}>
                  <option value="">— não informar —</option>
                  {enderecos.map((e) => (
                    <option key={e.id} value={e.id}>{e.rotulo}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Código de rastreio (manual)</label>
                <input value={codigoRastreamento} onChange={(e) => setCodigoRastreamento(e.target.value)} placeholder="Ex.: AD173823345BR — ou gere pelos Correios na Fase 4" className={inputClass} />
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Peso aferido (kg)</label>
              <input value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} inputMode="decimal" placeholder={pedido.pesoKg ? `previsto ${pedido.pesoKg.toFixed(2)}` : "ex.: 12,4"} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Qtd. volumes</label>
              <input value={qtdVolumes} onChange={(e) => setQtdVolumes(e.target.value)} inputMode="numeric" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Tipo de volume</label>
              <select value={tipoVolume} onChange={(e) => setTipoVolume(e.target.value)} className={inputClass}>
                {TIPOS_VOLUME.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Observação logística</label>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ex.: frágil, entregar no turno da manhã..." className={inputClass} />
          </div>

          {precisaAvisoNf && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" /> Este pedido NÃO tem NF-e autorizada.
              </p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={confirmaSemNf} onChange={(e) => setConfirmaSemNf(e.target.checked)} className="h-4 w-4" />
                Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando} className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50">
            {salvando ? "Salvando..." : modoEdicao ? "Salvar dados" : tipoEntrega === "RETIRADA" ? "Confirmar: aguardando retirada" : "Confirmar despacho"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/components/DespacharModal.tsx src/features/expedicao/services/enderecos.service.ts`
Esperado: zero erros. Se `getTransportadoras` tiver assinatura diferente, ajustar o cast `as Transportadora[]` para o retorno real. Validação funcional na Task 9 Step 6.

---

### Task 11: Modais leves — `RetiradaModal` e `VoltarStatusModal`

**Files:**
- Create: `src/features/expedicao/components/RetiradaModal.tsx`
- Create: `src/features/expedicao/components/VoltarStatusModal.tsx`

**Interfaces:**
- Consumes: `confirmarRetirada`, `voltarStatus`, `AtorExpedicao` (Task 8); `PedidoExpedicao` (Task 3).
- Produces:
  - `RetiradaModal({ pedido, ator, onClose, onDone })`
  - `VoltarStatusModal({ pedido, ator, onClose, onDone })`

- [ ] **Step 1: `RetiradaModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { confirmarRetirada } from "../services/expedicao-acoes.service";
import type { AtorExpedicao } from "../services/expedicao-acoes.service";
import type { PedidoExpedicao } from "../types";

export function RetiradaModal({
  pedido,
  ator,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  ator: AtorExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const [retiradoPor, setRetiradoPor] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleConfirmar() {
    if (salvando) return;
    setSalvando(true);
    const res = await confirmarRetirada(pedido.idInt, retiradoPor.trim(), ator);
    setSalvando(false);
    if (res.success) {
      showToast({ type: "success", title: "Retirada confirmada", description: `#${pedido.idInt} entregue no balcão.` });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível confirmar", description: res.error });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Confirmar retirada #{pedido.idInt}</h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">{pedido.cliente}</p>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Quem retirou?</label>
            <input
              value={retiradoPor}
              onChange={(e) => setRetiradoPor(e.target.value)}
              placeholder="Nome de quem levou o pedido"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando} className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {salvando ? "Confirmando..." : "Confirmar entrega"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `VoltarStatusModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { voltarStatus } from "../services/expedicao-acoes.service";
import type { AtorExpedicao } from "../services/expedicao-acoes.service";
import type { PedidoExpedicao } from "../types";

export function VoltarStatusModal({
  pedido,
  ator,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  ator: AtorExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleConfirmar() {
    if (salvando) return;
    setSalvando(true);
    const res = await voltarStatus(pedido.idInt, pedido.statusInterno, motivo.trim(), ator);
    setSalvando(false);
    if (res.success) {
      showToast({ type: "success", title: "Status desfeito", description: `#${pedido.idInt} voltou um passo.` });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível voltar", description: res.error });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Voltar status #{pedido.idInt}</h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Desfaz exatamente 1 passo do fluxo (status atual: {pedido.statusInterno}).
          </p>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Motivo (fica na trilha)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ex.: marcado por engano, pedido voltou para retrabalho..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando} className="rounded-2xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {salvando ? "Voltando..." : "Voltar 1 passo"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/components/`
Esperado: zero erros.

---

### Task 12: `TransportadorasModal` + categoria inicial no cadastro

**Files:**
- Create: `src/features/expedicao/components/TransportadorasModal.tsx`
- Modify: `src/app/(erp)/cadastros/novo/page.tsx`
- Modify: `src/features/cadastros/CadastroFormPage.tsx` (prop nova `categoriaInicial` + default do form em ~linha 2129)

**Interfaces:**
- Consumes: `getTransportadoras` (`@/features/nfe/services/nfe.service`); `CadastroCategoria` de `@/features/cadastros/types`.
- Produces: `TransportadorasModal({ onClose }: { onClose: () => void })`; `CadastroFormPage` aceita `categoriaInicial?: CadastroCategoria`; `/cadastros/novo?categoria=TRANSPORTADORA` pré-seleciona a categoria.

- [ ] **Step 1: `TransportadorasModal.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, X } from "lucide-react";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";

type Transportadora = {
  id_cliente: number;
  nome: string | null;
  fantasia: string | null;
  documento: string | null;
  cidade_uf: string | null;
};

export function TransportadorasModal({ onClose }: { onClose: () => void }) {
  const [lista, setLista] = useState<Transportadora[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    void getTransportadoras().then((rows) => {
      if (!ativo) return;
      setLista(rows as Transportadora[]);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((t) =>
      [t.nome, t.fantasia, t.documento, t.cidade_uf].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [lista, busca]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Transportadoras</h2>
          <div className="flex items-center gap-2">
            <Link
              href="/cadastros/novo?categoria=TRANSPORTADORA"
              className="inline-flex items-center gap-1.5 rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#123f61]"
            >
              <Plus className="h-4 w-4" /> Nova transportadora
            </Link>
            <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, CNPJ ou cidade..."
              className="w-full bg-transparent text-sm outline-none dark:text-slate-100"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {carregando ? (
            <p className="p-6 text-center text-sm text-slate-500">Carregando...</p>
          ) : filtradas.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Nenhuma transportadora encontrada.</p>
          ) : (
            filtradas.map((t) => (
              <div key={t.id_cliente} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{t.fantasia || t.nome}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[t.documento, t.cidade_uf].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Link
                  href={`/cadastros/${t.id_cliente}/editar`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Categoria inicial via query param**

Em `src/features/cadastros/CadastroFormPage.tsx`:
1. Na tipagem das props do componente (`CadastroFormPageProps`), adicionar `categoriaInicial?: CadastroCategoria;`.
2. Localizar a função que monta o form inicial (a expressão `categoria: cadastro?.categoria ?? "CLIENTE"` — hoje na linha ~2129) e trocar para `categoria: cadastro?.categoria ?? categoriaInicial ?? "CLIENTE"`, threading o parâmetro `categoriaInicial` até lá (a função recebe o `cadastro`; adicionar o segundo parâmetro e repassar do componente).

Em `src/app/(erp)/cadastros/novo/page.tsx`, substituir o conteúdo por:

```tsx
import { CadastroFormPage } from "@/features/cadastros/CadastroFormPage";
import type { CadastroCategoria } from "@/features/cadastros/types";

const CATEGORIAS_VALIDAS: CadastroCategoria[] = ["CLIENTE", "TRANSPORTADORA", "FORNECEDOR", "ORGAO_PUBLICO"];

export default async function NovoCadastroRoute({
  searchParams
}: {
  searchParams: Promise<{ categoria?: string }>;
}) {
  const params = await searchParams;
  const bruta = (params.categoria ?? "").toUpperCase() as CadastroCategoria;
  const categoriaInicial = CATEGORIAS_VALIDAS.includes(bruta) ? bruta : undefined;
  return <CadastroFormPage mode="new" categoriaInicial={categoriaInicial} />;
}
```

Se o projeto estiver em Next com `searchParams` síncrono (conferir outro `page.tsx` com searchParams, ex.: grep `searchParams` em `src/app/(erp)/`), usar a forma síncrona equivalente.

- [ ] **Step 3: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/components/TransportadorasModal.tsx "src/app/(erp)/cadastros/novo/page.tsx" src/features/cadastros/CadastroFormPage.tsx`
Em localhost: abrir Expedição → botão "Transportadoras" → lista com as 24 reais; buscar filtra; "Nova transportadora" abre o form com categoria TRANSPORTADORA pré-selecionada; "Editar" abre o cadastro correto.

---

### Task 13: Rastreio via n8n — service + parser + `RastreioModal`

**Files:**
- Create: `src/features/expedicao/services/rastro.service.ts`
- Create: `src/features/expedicao/components/RastreioModal.tsx`
- Create: `scratch/checar-rastro-parser.mjs` (verificação descartável do parser)

**Interfaces:**
- Consumes: webhook n8n `POST https://10074.hostoo.net.br/webhook/rastro-e-deal-todos` body `{"rastro": "<código>"}` → `{ sucesso: boolean, mensagem: string }` (mensagem formatada p/ WhatsApp — testada em 15/08/2026).
- Produces:
  - `rastrearObjeto(codigo: string): Promise<RastroResultado>`
  - `parseMensagemRastro(mensagem: string): RastroParse` (exportada para o teste)
  - `RastreioModal({ pedido, onClose, onMarcarEntregue }: { pedido: PedidoExpedicao; onClose: () => void; onMarcarEntregue: () => void })`

- [ ] **Step 1: Service + parser**

Criar `src/features/expedicao/services/rastro.service.ts`:

```ts
/**
 * Rastreio de objetos via fluxo n8n do dono (já pronto).
 * Resposta real (15/08/2026): { sucesso: true, mensagem: "📦 *Rastreamento do
 * Objeto* `AD...BR`\n🔖 *Categoria:* SEDEX\n...🕓 *Eventos:*\n\n╭━━\n┃ 📬 *titulo*\n┃ 📆 data\n┃ 📍 local\n┃ _detalhe_\n╰━━..." }
 * O parser é tolerante: se o formato mudar no n8n, a UI cai no texto bruto.
 */

const WEBHOOK_RASTRO = "https://10074.hostoo.net.br/webhook/rastro-e-deal-todos";

export type RastroEvento = {
  titulo: string;
  data: string | null;
  local: string | null;
  detalhe: string | null;
};

export type RastroParse = {
  resumo: Record<string, string>;
  eventos: RastroEvento[];
  entregue: boolean;
};

export type RastroResultado =
  | { ok: true; mensagemBruta: string; parse: RastroParse }
  | { ok: false; erro: string };

/** Remove os asteriscos de negrito do WhatsApp e espaços das bordas. */
function limpar(texto: string): string {
  return texto.replace(/\*/g, "").trim();
}

export function parseMensagemRastro(mensagem: string): RastroParse {
  const resumo: Record<string, string> = {};
  const eventos: RastroEvento[] = [];

  const [cabecalho, ...blocos] = mensagem.split("╭");

  // Cabeçalho: linhas "emoji *Rótulo:* valor"
  for (const linha of cabecalho.split("\n")) {
    const m = linha.match(/\*([^*]+):\*\s*(.+)$/);
    if (m) resumo[limpar(m[1])] = limpar(m[2]);
  }

  // Eventos: blocos entre ╭ e ╰, linhas iniciadas por ┃
  for (const bloco of blocos) {
    const linhas = bloco
      .split("\n")
      .map((l) => l.replace(/^[╭╰┃━\s]+/u, "").trim())
      .filter((l) => l !== "" && !/^[━╌]+$/u.test(l));
    if (linhas.length === 0) continue;
    const evento: RastroEvento = { titulo: "", data: null, local: null, detalhe: null };
    for (const linha of linhas) {
      if (linha.startsWith("📆")) evento.data = limpar(linha.replace("📆", ""));
      else if (linha.startsWith("📍")) evento.local = limpar(linha.replace("📍", ""));
      else if (linha.startsWith("_") || linha.endsWith("_")) evento.detalhe = limpar(linha.replace(/_/g, ""));
      else if (!evento.titulo) evento.titulo = limpar(linha.replace(/^[^\p{L}\p{N}]+/u, ""));
    }
    if (evento.titulo) eventos.push(evento);
  }

  const textoSituacao = `${resumo["Status"] ?? ""} ${resumo["Situação atual"] ?? ""} ${eventos[0]?.titulo ?? ""}`;
  const entregue = /entregue/i.test(textoSituacao);

  return { resumo, eventos, entregue };
}

export async function rastrearObjeto(codigo: string): Promise<RastroResultado> {
  try {
    const response = await fetch(WEBHOOK_RASTRO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rastro: codigo.trim() })
    });
    if (!response.ok) {
      return { ok: false, erro: `Falha na consulta (HTTP ${response.status}).` };
    }
    const data = (await response.json().catch(() => null)) as { sucesso?: boolean; mensagem?: string } | null;
    if (!data || data.sucesso !== true || typeof data.mensagem !== "string") {
      return { ok: false, erro: data?.mensagem ? String(data.mensagem) : "Resposta inesperada do rastreador." };
    }
    return { ok: true, mensagemBruta: data.mensagem, parse: parseMensagemRastro(data.mensagem) };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Erro de rede ao consultar o rastreio." };
  }
}
```

Nota CORS: os webhooks n8n de cotação já são chamados do client em `frete.service.ts` — mesmo padrão. Se ESTE webhook bloquear CORS no teste, criar proxy fino `src/app/api/expedicao/rastro/route.ts` (POST repassando o body e devolvendo o JSON) e trocar `WEBHOOK_RASTRO` por `/api/expedicao/rastro`.

- [ ] **Step 2: Verificação descartável do parser**

Criar `scratch/checar-rastro-parser.mjs`: copiar literalmente as funções `limpar` e `parseMensagemRastro` (sem tipos TS) + colar a `mensagem` REAL capturada na conversa de 15/08/2026 (objeto `AD173823345BR` — cabeçalho com Categoria/Formato/Peso/Status/Situação/Local/Última atualização/Previsão e 7 eventos) e assertar:

```js
const r = parseMensagemRastro(MENSAGEM_REAL);
let falhas = 0;
const esperar = (cond, rotulo) => { if (!cond) { console.error("FALHOU:", rotulo); falhas++; } };
esperar(r.resumo["Categoria"] === "SEDEX", "categoria");
esperar(r.resumo["Situação atual"] === "Objeto entregue ao destinatário", "situacao");
esperar(r.eventos.length === 7, `eventos = ${r.eventos.length}, esperado 7`);
esperar(r.eventos[0].titulo.includes("Objeto entregue"), "primeiro evento");
esperar(r.eventos[6].titulo.includes("Etiqueta emitida"), "ultimo evento");
esperar(r.entregue === true, "entregue");
process.exitCode = falhas === 0 ? 0 : 1;
```

Run: `node scratch/checar-rastro-parser.mjs` — esperado: exit 0 sem "FALHOU".

- [ ] **Step 3: `RastreioModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, RefreshCw, X } from "lucide-react";
import { rastrearObjeto } from "../services/rastro.service";
import type { RastroResultado } from "../services/rastro.service";
import type { PedidoExpedicao } from "../types";

export function RastreioModal({
  pedido,
  onClose,
  onMarcarEntregue
}: {
  pedido: PedidoExpedicao;
  onClose: () => void;
  onMarcarEntregue: () => void;
}) {
  const [resultado, setResultado] = useState<RastroResultado | null>(null);

  async function consultar() {
    setResultado(null);
    setResultado(await rastrearObjeto(pedido.codigoRastreamento));
  }

  useEffect(() => {
    void consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.codigoRastreamento]);

  const podeMarcarEntregue = resultado?.ok === true && resultado.parse.entregue && pedido.etapa === "EM_TRANSITO";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Rastreamento #{pedido.idInt}</h2>
            <p className="font-mono text-xs font-bold text-slate-500">{pedido.codigoRastreamento}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void consultar()} title="Atualizar" className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {resultado === null && <p className="text-center text-sm text-slate-500">Consultando os Correios...</p>}

          {resultado?.ok === false && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {resultado.erro}
            </div>
          )}

          {resultado?.ok === true && (
            <>
              {Object.keys(resultado.parse.resumo).length > 0 ? (
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/50">
                  {["Status", "Situação atual", "Local atual", "Última atualização", "Previsão de entrega", "Peso"].map((chave) =>
                    resultado.parse.resumo[chave] ? (
                      <div key={chave}>
                        <p className="text-[10px] font-bold uppercase text-slate-400">{chave}</p>
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{resultado.parse.resumo[chave]}</p>
                      </div>
                    ) : null
                  )}
                </div>
              ) : null}

              {resultado.parse.eventos.length > 0 ? (
                <ol className="space-y-3">
                  {resultado.parse.eventos.map((ev, i) => (
                    <li key={i} className="rounded-2xl border border-slate-100 p-3 text-sm dark:border-slate-800">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{ev.titulo}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        {ev.data && <span>{ev.data}</span>}
                        {ev.local && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {ev.local}
                          </span>
                        )}
                      </p>
                      {ev.detalhe && <p className="mt-1 text-xs italic text-slate-500">{ev.detalhe}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                // Fallback: formato mudou no n8n — mostra o texto bruto, nunca quebra.
                <pre className="whitespace-pre-wrap rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                  {resultado.mensagemBruta}
                </pre>
              )}
            </>
          )}
        </div>

        {podeMarcarEntregue && (
          <div className="border-t border-slate-100 bg-emerald-50 p-4 dark:border-slate-800 dark:bg-emerald-950/30">
            <button
              type="button"
              onClick={onMarcarEntregue}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" /> Correios confirmam a entrega — marcar ENTREGUE no sistema
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Validar**

Run: `npx tsc --noEmit`, `npx eslint src/features/expedicao/`, `node scratch/checar-rastro-parser.mjs`
Em localhost: num pedido com rastreio real (usar `AD173823345BR` gravando-o temporariamente OU um pedido em trânsito de verdade), abrir "Rastrear objeto": resumo + linha do tempo renderizam; botão verde de entrega aparece só quando o objeto consta entregue E o pedido está EM TRANSITO. Se o navegador acusar CORS no console, aplicar o proxy do Step 1 (nota).

---

## FASE 3 — Etiqueta térmica interna (10×15 cm)

### Task 14: ViewModel da etiqueta + documento PDF

**Files:**
- Create: `src/features/expedicao/services/etiqueta-viewmodel.service.ts` (server-side)
- Create: `src/features/expedicao/pdf/EtiquetaPdfDocument.tsx`

**Interfaces:**
- Consumes: tabelas `propostas`, `propostas_os`, `expedicoes`, `enderecos`, `clientes`, `empresas`, `cotacao_frete`; tipos da Task 3.
- Produces (Task 15 consome):
  - `montarEtiquetaViewModel(supabase: SupabaseClient, idInt: number): Promise<EtiquetaViewModel | null>` com:
    ```ts
    type EtiquetaViewModel = {
      idInt: number;
      volumes: number;                    // >= 1
      pesoKg: string;                     // "12,40" ou ""
      transportadora: string;
      codigoRastreamento: string;
      obs: string;
      remetente: { nome: string; linha1: string; linha2: string };
      destinatario: { nome: string; recebedor: string; linha1: string; linha2: string; cepCidadeUf: string; telefone: string };
    };
    ```
  - `EtiquetaPdfDocument({ vm, qrDataUrl }: { vm: EtiquetaViewModel; qrDataUrl: string | null }): ReactElement` — 1 `<Page>` 100×150 mm por volume.

- [ ] **Step 1: ViewModel (server)**

Criar `src/features/expedicao/services/etiqueta-viewmodel.service.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type EtiquetaViewModel = {
  idInt: number;
  volumes: number;
  pesoKg: string;
  transportadora: string;
  codigoRastreamento: string;
  obs: string;
  remetente: { nome: string; linha1: string; linha2: string };
  destinatario: {
    nome: string;
    recebedor: string;
    linha1: string;
    linha2: string;
    cepCidadeUf: string;
    telefone: string;
  };
};

function fmtPeso(pesoKg: number | null): string {
  if (pesoKg === null || !Number.isFinite(pesoKg) || pesoKg <= 0) return "";
  return pesoKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function montarEtiquetaViewModel(
  supabase: SupabaseClient,
  idInt: number
): Promise<EtiquetaViewModel | null> {
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, cliente, id_cliente, empresa, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return null;

  const [{ data: exp }, { data: os }, { data: frete }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("peso_kg, qtd_volumes, transportadora_nome, codigo_rastreamento, id_endereco_entrega, obs")
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("propostas_os")
      .select("codigo_rastreamento")
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("cotacao_frete")
      .select("servico, peso, cep")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle()
  ]);

  // Endereço: o escolhido no despacho > o que casa com o CEP cotado > o mais recente.
  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;
  let endereco: {
    endereco: string | null; numero: string | null; complemento: string | null;
    bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
    recebedor: string | null;
  } | null = null;

  if (exp?.id_endereco_entrega) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor")
      .eq("id", exp.id_endereco_entrega)
      .maybeSingle();
    endereco = data ?? null;
  }
  if (!endereco && idCliente !== null) {
    const { data: lista } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor, data_criacao")
      .eq("id_cliente", idCliente)
      .order("data_criacao", { ascending: false });
    const cepAlvo = (frete?.cep ?? proposta.cep ?? "").replace(/\D/g, "");
    endereco =
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) ||
      (lista ?? [])[0] ||
      null;
  }

  const { data: cliente } = idCliente !== null
    ? await supabase
        .from("clientes")
        .select("nome, fantasia, whatsapp_1, telefone_fixo, cidade_uf")
        .eq("id_cliente", idCliente)
        .maybeSingle()
    : { data: null };

  // Remetente: empresas casada por nome com propostas.empresa; fallback = 1ª linha
  // (em 15/08/2026 "E3 Brindes" não tem linha em empresas — cai no fallback).
  let empresaRow:
    | { nome_fantasia: string | null; razao_social: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null; cep: string | null; telefone_nfe: string | null }
    | null = null;
  const nomeEmpresa = String(proposta.empresa ?? "").trim();
  if (nomeEmpresa) {
    const { data } = await supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, logradouro, numero, complemento, bairro, municipio, uf, cep, telefone_nfe, empresa")
      .or(`empresa.eq."${nomeEmpresa}",nome_fantasia.eq."${nomeEmpresa}",razao_social.eq."${nomeEmpresa}"`)
      .limit(1)
      .maybeSingle();
    empresaRow = data ?? null;
  }
  if (!empresaRow) {
    const { data } = await supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, logradouro, numero, complemento, bairro, municipio, uf, cep, telefone_nfe")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    empresaRow = data ?? null;
  }

  const volumes = Math.max(1, Number(exp?.qtd_volumes) || 1);
  const pesoKg = fmtPeso(exp?.peso_kg !== null && exp?.peso_kg !== undefined ? Number(exp.peso_kg) : frete?.peso ? Number(frete.peso) / 1000 : null);

  const destLinha1 = endereco
    ? [[endereco.endereco, endereco.numero].filter(Boolean).join(", "), endereco.complemento].filter(Boolean).join(" - ")
    : "";
  const destLinha2 = endereco ? [endereco.bairro].filter(Boolean).join("") : "";
  const destCepCidade = endereco
    ? [`CEP ${endereco.cep ?? "—"}`, [endereco.cidade, endereco.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ")
    : cliente?.cidade_uf ?? "";

  return {
    idInt,
    volumes,
    pesoKg,
    transportadora: exp?.transportadora_nome || frete?.servico || "",
    codigoRastreamento: exp?.codigo_rastreamento || os?.codigo_rastreamento || "",
    obs: exp?.obs || "",
    remetente: {
      nome: empresaRow?.nome_fantasia || empresaRow?.razao_social || nomeEmpresa || "Remetente",
      linha1: empresaRow
        ? [[empresaRow.logradouro, empresaRow.numero].filter(Boolean).join(", "), empresaRow.complemento, empresaRow.bairro].filter(Boolean).join(" - ")
        : "",
      linha2: empresaRow
        ? [`CEP ${empresaRow.cep ?? "—"}`, [empresaRow.municipio, empresaRow.uf].filter(Boolean).join("/"), empresaRow.telefone_nfe].filter(Boolean).join(" · ")
        : ""
    },
    destinatario: {
      nome: proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido #${idInt}`,
      recebedor: endereco?.recebedor || "",
      linha1: destLinha1,
      linha2: destLinha2,
      cepCidadeUf: destCepCidade,
      telefone: cliente?.whatsapp_1 || cliente?.telefone_fixo || ""
    }
  };
}
```

- [ ] **Step 2: Documento PDF 100×150 mm**

Criar `src/features/expedicao/pdf/EtiquetaPdfDocument.tsx` (`@react-pdf/renderer`; 1 mm = 2.83465 pt → página `{ width: 283.46, height: 425.2 }`):

```tsx
import { createElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";

// 100 x 150 mm em pontos (1 mm = 2.83465 pt)
const LARGURA = 283.46;
const ALTURA = 425.2;

const styles = StyleSheet.create({
  page: { width: LARGURA, height: ALTURA, padding: 12, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  secao: { marginBottom: 6 },
  rotulo: { fontSize: 6.5, textTransform: "uppercase", color: "#333", marginBottom: 1 },
  remetente: { fontSize: 8, lineHeight: 1.25 },
  destNome: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  destLinha: { fontSize: 10, lineHeight: 1.3 },
  destCep: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  divisor: { borderBottomWidth: 1, borderBottomColor: "#000", marginVertical: 6 },
  rodape: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto" },
  pedido: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  volume: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  qr: { width: 64, height: 64 },
  obs: { fontSize: 7.5, marginTop: 3, color: "#111" }
});

export function EtiquetaPdfDocument({
  vm,
  qrDataUrl
}: {
  vm: EtiquetaViewModel;
  qrDataUrl: string | null;
}) {
  const paginas = Array.from({ length: vm.volumes }, (_, i) => i + 1);
  return (
    <Document title={`Etiqueta ${vm.idInt}`}>
      {paginas.map((n) => (
        <Page key={n} size={{ width: LARGURA, height: ALTURA }} style={styles.page}>
          <View style={styles.secao}>
            <Text style={styles.rotulo}>Remetente</Text>
            <Text style={styles.remetente}>{vm.remetente.nome}</Text>
            {vm.remetente.linha1 ? <Text style={styles.remetente}>{vm.remetente.linha1}</Text> : null}
            {vm.remetente.linha2 ? <Text style={styles.remetente}>{vm.remetente.linha2}</Text> : null}
          </View>

          <View style={styles.divisor} />

          <View style={styles.secao}>
            <Text style={styles.rotulo}>Destinatário</Text>
            <Text style={styles.destNome}>{vm.destinatario.nome}</Text>
            {vm.destinatario.recebedor ? <Text style={styles.destLinha}>A/C: {vm.destinatario.recebedor}</Text> : null}
            {vm.destinatario.linha1 ? <Text style={styles.destLinha}>{vm.destinatario.linha1}</Text> : null}
            {vm.destinatario.linha2 ? <Text style={styles.destLinha}>{vm.destinatario.linha2}</Text> : null}
            {vm.destinatario.cepCidadeUf ? <Text style={styles.destCep}>{vm.destinatario.cepCidadeUf}</Text> : null}
            {vm.destinatario.telefone ? <Text style={styles.destLinha}>Tel: {vm.destinatario.telefone}</Text> : null}
          </View>

          <View style={styles.divisor} />

          <View style={styles.secao}>
            <Text style={styles.rotulo}>Transporte</Text>
            <Text style={styles.destLinha}>
              {vm.transportadora || "—"}
              {vm.pesoKg ? `  ·  ${vm.pesoKg} kg` : ""}
            </Text>
            {vm.codigoRastreamento ? <Text style={styles.destLinha}>Rastreio: {vm.codigoRastreamento}</Text> : null}
            {vm.obs ? <Text style={styles.obs}>Obs: {vm.obs}</Text> : null}
          </View>

          <View style={styles.rodape}>
            <View>
              <Text style={styles.pedido}>#{vm.idInt}</Text>
              <Text style={styles.volume}>VOLUME {n}/{vm.volumes}</Text>
            </View>
            {qrDataUrl ? <Image src={qrDataUrl} style={styles.qr} /> : null}
          </View>
        </Page>
      ))}
    </Document>
  );
}

/** Fábrica usada pela rota (mesmo padrão createElement do imprimir-os). */
export function criarEtiquetaElement(vm: EtiquetaViewModel, qrDataUrl: string | null) {
  return createElement(EtiquetaPdfDocument, { vm, qrDataUrl });
}
```

- [ ] **Step 3: Validar**

Run: `npx tsc --noEmit` e `npx eslint src/features/expedicao/pdf/ src/features/expedicao/services/etiqueta-viewmodel.service.ts`
Esperado: zero erros. Validação visual na Task 15.

---

### Task 15: Rota `/api/expedicao/etiqueta` + client de impressão + botão

**Files:**
- Create: `src/app/api/expedicao/etiqueta/route.ts`
- Create: `src/features/expedicao/services/etiqueta.client.ts`
- Modify: `src/features/expedicao/ExpedicaoPage.tsx` (item no menu ⋯)

**Interfaces:**
- Consumes: `montarEtiquetaViewModel` + `criarEtiquetaElement` (Task 14); padrão de auth de `src/app/api/pedidos/imprimir-os/route.ts:155-177` (Bearer OU cookie → `auth.getUser()` → `verificarPermissaoServerSide`).
- Produces: `GET /api/expedicao/etiqueta?id_int=123&volumes=3` → PDF inline `etiqueta_123.pdf`; `abrirEtiqueta(idInt: number, volumes?: number | null): Promise<{ success: boolean; errorMessage?: string }>`.

- [ ] **Step 1: A rota**

Criar `src/app/api/expedicao/etiqueta/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import QRCode from "qrcode";
import { renderToBuffer } from "@react-pdf/renderer";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { montarEtiquetaViewModel } from "@/features/expedicao/services/etiqueta-viewmodel.service";
import { criarEtiquetaElement } from "@/features/expedicao/pdf/EtiquetaPdfDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Erro legível na aba (a etiqueta abre por navegação, como o PDF da OS). */
function respostaErro(request: Request, message: string, status: number) {
  const aceitaHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!aceitaHtml) return NextResponse.json({ success: false, message }, { status });
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Etiqueta</title><body style="font-family:sans-serif;padding:2rem"><h1>Não foi possível gerar a etiqueta</h1><p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idInt = Number(searchParams.get("id_int"));
  const volumesParam = searchParams.get("volumes");
  if (!Number.isFinite(idInt) || idInt <= 0) {
    return respostaErro(request, "Parâmetro id_int inválido.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return respostaErro(request, "Supabase não configurado no servidor.", 500);

  // Bearer (fetch programático) OU cookie (aba aberta por navegação) —
  // mesmo padrão de /api/pedidos/imprimir-os.
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return respostaErro(request, "Sessão não encontrada ou expirada. Faça login novamente.", 401);
  }
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.view");
  if (!temPermissao) {
    return respostaErro(request, "Sem permissão para gerar etiquetas (expedicao.view).", 403);
  }

  const vm = await montarEtiquetaViewModel(supabase, idInt);
  if (!vm) return respostaErro(request, `Pedido #${idInt} não encontrado.`, 404);
  const volumesOverride = volumesParam !== null ? Math.trunc(Number(volumesParam)) : NaN;
  if (Number.isFinite(volumesOverride) && volumesOverride > 0 && volumesOverride <= 50) {
    vm.volumes = volumesOverride;
  }

  // QR: link do pedido no ERP (conferência interna escaneia e acha o pedido).
  let qrDataUrl: string | null = null;
  try {
    const base = (process.env.APP_URL || "").trim() || new URL(request.url).origin;
    qrDataUrl = await QRCode.toDataURL(`${base}/orcamentos/${idInt}`, { margin: 0, width: 256 });
  } catch {
    qrDataUrl = null; // etiqueta sai sem QR — não é bloqueante
  }

  const pdf = await renderToBuffer(criarEtiquetaElement(vm, qrDataUrl));
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta_${idInt}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
```

Conferir contra `src/app/api/pedidos/imprimir-os/route.ts` (linhas 140-180): se os nomes das env vars do Supabase divergirem (ex.: helper próprio), usar exatamente o que a rota da OS usa.

- [ ] **Step 2: O client**

Criar `src/features/expedicao/services/etiqueta.client.ts` (mesmo desenho do `abrirPdfOs` — aba síncrona no clique, fallback download com Bearer):

```ts
import { getSupabaseClient } from "@/lib/supabase/client";

export interface AbrirEtiquetaResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Abre o PDF da etiqueta 10x15. A aba abre SINCRONAMENTE no clique (anti
 * popup-block); a rota autentica pelo cookie. Popup bloqueado => download via
 * fetch com Bearer (mesmo padrão de abrirPdfOs).
 */
export async function abrirEtiqueta(idInt: number, volumes?: number | null): Promise<AbrirEtiquetaResult> {
  const params = new URLSearchParams({ id_int: String(idInt) });
  if (volumes && volumes > 0) params.set("volumes", String(volumes));
  const url = `/api/expedicao/etiqueta?${params.toString()}`;

  const win = typeof window !== "undefined" ? window.open(url, "_blank") : null;
  if (win) return { success: true };

  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let message = `Falha ao gerar a etiqueta (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        if (body?.message) message = String(body.message);
      } catch {
        // resposta sem JSON — mantém a mensagem genérica
      }
      return { success: false, errorMessage: message };
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `etiqueta_${idInt}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { success: true };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar a etiqueta." };
  }
}
```

- [ ] **Step 3: Botão no menu ⋯ da tela**

Em `ExpedicaoPage.tsx`, no array `acoesMenu` (Task 9 Step 2), adicionar ANTES de "Detalhes da proposta":

```tsx
                ...(canOperar && p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO"
                  ? [{
                      label: "Imprimir etiqueta 10x15",
                      onClick: () => {
                        void abrirEtiqueta(p.idInt, p.volumes).then((res) => {
                          if (!res.success) {
                            showToast({ type: "error", title: "Erro na etiqueta", description: res.errorMessage });
                          }
                        });
                      }
                    }]
                  : []),
```

Import: `abrirEtiqueta` de `./services/etiqueta.client`.

- [ ] **Step 4: Validar (visual)**

Run: `npx tsc --noEmit` e `npx eslint src/app/api/expedicao/ src/features/expedicao/`
Em localhost, num pedido pós-pronto: menu ⋯ → "Imprimir etiqueta 10x15":
1. PDF abre na aba com N páginas = volumes (testar com 3 volumes gravados no Despachar).
2. Página em proporção 2:3 (10×15) — imprimir em PDF virtual e conferir o tamanho do papel.
3. Remetente = empresa do pedido; destinatário = endereço escolhido no despacho; VOLUME i/N e QR presentes.
4. Sem sessão (aba anônima), a rota devolve o HTML de erro 401 legível.

---

## FASE 4 — Correios (API CWS oficial)

### Task 16: Cliente CWS server-only + rota de status

**Files:**
- Create: `src/lib/correios/cws.ts`
- Create: `src/app/api/expedicao/correios/status/route.ts`
- Modify: `.env.local` (o EXECUTOR NÃO cria os valores — deixar o bloco comentado para o dono preencher)

**Interfaces:**
- Consumes: env `CORREIOS_AMBIENTE` (`homologacao`|`producao`), `CORREIOS_USUARIO`, `CORREIOS_CODIGO_ACESSO`, `CORREIOS_CARTAO_POSTAGEM`, `CORREIOS_SERVICO_SEDEX` (default `03220`), `CORREIOS_SERVICO_PAC` (default `03298`).
- Produces (Task 17 consome):
  - `correiosConfigurado(): boolean`
  - `criarPrepostagem(input: CwsPrepostagemInput): Promise<{ id: string; codigoObjeto: string }>`
  - `baixarRotuloPdf(idPrepostagem: string): Promise<Buffer>`
  - `GET /api/expedicao/correios/status` → `{ configurado: boolean, ambiente: string | null }`

- [ ] **Step 1: VALIDAR os contratos da API na documentação oficial**

Antes de codar, com WebFetch, confirmar em `https://cws.correios.com.br` / documentação pública do CWS ("API Prepostagem" e "API Token"):
1. Auth: `POST {base}/token/v1/autentica/cartaopostagem` com header `Authorization: Basic base64(usuario:codigo_acesso)` e body `{ "numero": "<cartao>" }` → resposta com `token` (JWT) e validade.
2. Criação: `POST {base}/prepostagem/v1/prepostagens` (Bearer) — payload mínimo com `remetente`, `destinatario` (nome, endereço com cep/logradouro/numero/bairro/cidade/uf), `codigoServico`, `pesoInformado` (gramas), `codigoFormatoObjetoInformado` (2 = pacote), dimensões informadas, `cienteObjetoNaoProibido: 1` → resposta com `id` e `codigoObjeto`.
3. Rótulo: `POST {base}/prepostagem/v1/prepostagens/rotulo/assincrono/pdf` body `{ "idsPrePostagem": ["<id>"], "tipoRotulo": "P", "formatoRotulo": "ET" }` → `{ idRecibo }`; depois `GET {base}/prepostagem/v1/prepostagens/rotulo/download/assincrono/{idRecibo}` → JSON com PDF base64 (campo `dados` ou nome equivalente conforme doc).
4. Bases: produção `https://api.correios.com.br`, homologação `https://apihom.correios.com.br`.

Ajustar QUALQUER divergência (paths, nomes de campos, formato ET p/ etiqueta 10x15) no código do Step 2 antes de prosseguir. Anotar no código a data e a fonte da validação.

- [ ] **Step 2: `src/lib/correios/cws.ts`**

```ts
/**
 * Cliente da API CWS dos Correios (prepostagem + rótulo). SERVER-ONLY.
 * Endpoints validados contra a doc oficial em <DATA_DA_VALIDACAO — Step 1>.
 * Credenciais: .env.local (o dono replica na Vercel quando publicar).
 */

const BASES: Record<string, string> = {
  producao: "https://api.correios.com.br",
  homologacao: "https://apihom.correios.com.br"
};

type CwsConfig = {
  base: string;
  ambiente: "producao" | "homologacao";
  usuario: string;
  codigoAcesso: string;
  cartaoPostagem: string;
  servicoSedex: string;
  servicoPac: string;
};

export function lerConfigCorreios(): CwsConfig | null {
  const ambiente = (process.env.CORREIOS_AMBIENTE || "").trim() as CwsConfig["ambiente"];
  const usuario = (process.env.CORREIOS_USUARIO || "").trim();
  const codigoAcesso = (process.env.CORREIOS_CODIGO_ACESSO || "").trim();
  const cartaoPostagem = (process.env.CORREIOS_CARTAO_POSTAGEM || "").trim();
  if (!BASES[ambiente] || !usuario || !codigoAcesso || !cartaoPostagem) return null;
  return {
    base: BASES[ambiente],
    ambiente,
    usuario,
    codigoAcesso,
    cartaoPostagem,
    servicoSedex: (process.env.CORREIOS_SERVICO_SEDEX || "03220").trim(),
    servicoPac: (process.env.CORREIOS_SERVICO_PAC || "03298").trim()
  };
}

export function correiosConfigurado(): boolean {
  return lerConfigCorreios() !== null;
}

class CorreiosApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "CorreiosApiError";
  }
}

async function lerErro(response: Response): Promise<string> {
  try {
    const body = await response.json();
    // A API devolve msgs em formatos variados; concatena o que achar.
    const msgs = [body?.mensagem, body?.msg, ...(Array.isArray(body?.msgs) ? body.msgs : [])]
      .filter(Boolean)
      .join(" | ");
    return msgs || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** Token do cartão de postagem (JWT, dura horas — sem cache nesta fase: 1 chamada por operação). */
async function obterToken(cfg: CwsConfig): Promise<string> {
  const basic = Buffer.from(`${cfg.usuario}:${cfg.codigoAcesso}`).toString("base64");
  const response = await fetch(`${cfg.base}/token/v1/autentica/cartaopostagem`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({ numero: cfg.cartaoPostagem })
  });
  if (!response.ok) throw new CorreiosApiError(response.status, `Autenticação Correios: ${await lerErro(response)}`);
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new CorreiosApiError(500, "Autenticação Correios: resposta sem token.");
  return data.token;
}

export type CwsPrepostagemInput = {
  servico: "SEDEX" | "PAC";
  pesoGramas: number;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  remetente: {
    nome: string; cep: string; logradouro: string; numero: string; complemento: string;
    bairro: string; cidade: string; uf: string; telefone: string; cnpj: string;
  };
  destinatario: {
    nome: string; cep: string; logradouro: string; numero: string; complemento: string;
    bairro: string; cidade: string; uf: string; telefone: string;
  };
};

export async function criarPrepostagem(
  input: CwsPrepostagemInput
): Promise<{ id: string; codigoObjeto: string }> {
  const cfg = lerConfigCorreios();
  if (!cfg) throw new CorreiosApiError(500, "Credenciais dos Correios não configuradas.");
  const token = await obterToken(cfg);

  const payload = {
    codigoServico: input.servico === "SEDEX" ? cfg.servicoSedex : cfg.servicoPac,
    remetente: {
      nome: input.remetente.nome,
      cpfCnpj: input.remetente.cnpj.replace(/\D/g, ""),
      dddTelefone: input.remetente.telefone.replace(/\D/g, "").slice(0, 2),
      telefone: input.remetente.telefone.replace(/\D/g, "").slice(2),
      endereco: {
        cep: input.remetente.cep.replace(/\D/g, ""),
        logradouro: input.remetente.logradouro,
        numero: input.remetente.numero || "S/N",
        complemento: input.remetente.complemento,
        bairro: input.remetente.bairro,
        cidade: input.remetente.cidade,
        uf: input.remetente.uf
      }
    },
    destinatario: {
      nome: input.destinatario.nome,
      dddTelefone: input.destinatario.telefone.replace(/\D/g, "").slice(0, 2),
      telefone: input.destinatario.telefone.replace(/\D/g, "").slice(2),
      endereco: {
        cep: input.destinatario.cep.replace(/\D/g, ""),
        logradouro: input.destinatario.logradouro,
        numero: input.destinatario.numero || "S/N",
        complemento: input.destinatario.complemento,
        bairro: input.destinatario.bairro,
        cidade: input.destinatario.cidade,
        uf: input.destinatario.uf
      }
    },
    codigoFormatoObjetoInformado: "2",
    pesoInformado: String(Math.max(1, Math.round(input.pesoGramas))),
    alturaInformada: String(Math.max(1, Math.round(input.alturaCm))),
    larguraInformada: String(Math.max(1, Math.round(input.larguraCm))),
    comprimentoInformado: String(Math.max(1, Math.round(input.comprimentoCm))),
    cienteObjetoNaoProibido: "1",
    modalidadePagamento: "2"
  };

  const response = await fetch(`${cfg.base}/prepostagem/v1/prepostagens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new CorreiosApiError(response.status, `Prepostagem: ${await lerErro(response)}`);
  const data = (await response.json()) as { id?: string; codigoObjeto?: string };
  if (!data.id || !data.codigoObjeto) throw new CorreiosApiError(500, "Prepostagem: resposta sem id/codigoObjeto.");
  return { id: String(data.id), codigoObjeto: String(data.codigoObjeto) };
}

/** Solicita o rótulo (assíncrono) e baixa o PDF pronto para térmica (formato ET). */
export async function baixarRotuloPdf(idPrepostagem: string): Promise<Buffer> {
  const cfg = lerConfigCorreios();
  if (!cfg) throw new CorreiosApiError(500, "Credenciais dos Correios não configuradas.");
  const token = await obterToken(cfg);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const solicitar = await fetch(`${cfg.base}/prepostagem/v1/prepostagens/rotulo/assincrono/pdf`, {
    method: "POST",
    headers,
    body: JSON.stringify({ idsPrePostagem: [idPrepostagem], tipoRotulo: "P", formatoRotulo: "ET" })
  });
  if (!solicitar.ok) throw new CorreiosApiError(solicitar.status, `Rótulo (solicitação): ${await lerErro(solicitar)}`);
  const { idRecibo } = (await solicitar.json()) as { idRecibo?: string };
  if (!idRecibo) throw new CorreiosApiError(500, "Rótulo: resposta sem idRecibo.");

  // Poll curto: o PDF costuma ficar pronto em segundos.
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    await new Promise((r) => setTimeout(r, tentativa === 0 ? 800 : 1500));
    const download = await fetch(
      `${cfg.base}/prepostagem/v1/prepostagens/rotulo/download/assincrono/${idRecibo}`,
      { headers }
    );
    if (download.status === 200) {
      const body = (await download.json()) as { dados?: string; nome?: string };
      if (body.dados) return Buffer.from(body.dados, "base64");
      throw new CorreiosApiError(500, "Rótulo: download sem campo de dados.");
    }
    if (download.status !== 202 && download.status !== 404) {
      throw new CorreiosApiError(download.status, `Rótulo (download): ${await lerErro(download)}`);
    }
  }
  throw new CorreiosApiError(504, "Rótulo: tempo esgotado aguardando o PDF dos Correios.");
}
```

- [ ] **Step 3: Rota de status + bloco no `.env.local`**

Criar `src/app/api/expedicao/correios/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { correiosConfigurado, lerConfigCorreios } from "@/lib/correios/cws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = lerConfigCorreios();
  return NextResponse.json({ configurado: correiosConfigurado(), ambiente: cfg?.ambiente ?? null });
}
```

Adicionar ao `.env.local` (comentado — os VALORES são do dono):

```
# Correios CWS (prepostagem/rotulo) — preencher e replicar na Vercel ao publicar
# CORREIOS_AMBIENTE=homologacao
# CORREIOS_USUARIO=
# CORREIOS_CODIGO_ACESSO=
# CORREIOS_CARTAO_POSTAGEM=
# CORREIOS_SERVICO_SEDEX=03220
# CORREIOS_SERVICO_PAC=03298
```

- [ ] **Step 4: Validar**

Run: `npx tsc --noEmit`; `curl http://localhost:3000/api/expedicao/correios/status` → `{"configurado":false,"ambiente":null}` sem credenciais; após o dono preencher `.env.local` (homologação) e reiniciar o dev server → `{"configurado":true,"ambiente":"homologacao"}`.

---

### Task 17: Rotas de prepostagem + rótulo e botões na UI

**Files:**
- Create: `src/app/api/expedicao/correios/prepostagem/route.ts`
- Create: `src/app/api/expedicao/correios/etiqueta/route.ts`
- Create: `src/features/expedicao/services/correios.client.ts`
- Modify: `src/features/expedicao/components/DespacharModal.tsx` (botão "Gerar prepostagem")
- Modify: `src/features/expedicao/ExpedicaoPage.tsx` (menu ⋯: "Etiqueta Correios (oficial)")

**Interfaces:**
- Consumes: `criarPrepostagem`, `baixarRotuloPdf`, `correiosConfigurado` (Task 16); `montarEtiquetaViewModel` NÃO (a prepostagem monta os dados direto das tabelas); padrão de auth da Task 15.
- Produces:
  - `POST /api/expedicao/correios/prepostagem` body `{ id_int: number, servico: "SEDEX" | "PAC" }` → `{ success: true, codigoObjeto: string }` (grava `expedicoes.correios_id_prepostagem`, `correios_codigo_objeto`, `codigo_rastreamento` e espelha `propostas_os.codigo_rastreamento`)
  - `GET /api/expedicao/correios/etiqueta?id_int=123` → PDF do rótulo oficial
  - Client: `correiosStatus(): Promise<{ configurado: boolean }>`, `gerarPrepostagem(idInt: number, servico: "SEDEX" | "PAC"): Promise<{ success: boolean; codigoObjeto?: string; errorMessage?: string }>`, `abrirEtiquetaCorreios(idInt: number): Promise<{ success: boolean; errorMessage?: string }>`

- [ ] **Step 1: Rota de prepostagem**

Criar `src/app/api/expedicao/correios/prepostagem/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { criarPrepostagem, correiosConfigurado } from "@/lib/correios/cws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!correiosConfigurado()) {
    return NextResponse.json({ success: false, message: "Correios não configurados no servidor." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { id_int?: number; servico?: string } | null;
  const idInt = Number(body?.id_int);
  const servico = body?.servico === "PAC" ? "PAC" : "SEDEX";
  if (!Number.isFinite(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 });
  }
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.operar");
  if (!temPermissao) {
    return NextResponse.json({ success: false, message: "Sem permissão (expedicao.operar)." }, { status: 403 });
  }

  // Dados do pedido: mesmas fontes da etiqueta interna.
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, cliente, id_cliente, empresa, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return NextResponse.json({ success: false, message: "Pedido não encontrado." }, { status: 404 });

  const [{ data: exp }, { data: frete }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("peso_kg, id_endereco_entrega")
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("cotacao_frete")
      .select("peso, altura, largura, comprimento, cep")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle()
  ]);

  // Endereço do destinatário (o escolhido no despacho; senão por CEP; senão o mais novo)
  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;
  let endereco: Record<string, unknown> | null = null;
  if (exp?.id_endereco_entrega) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep")
      .eq("id", exp.id_endereco_entrega)
      .maybeSingle();
    endereco = data;
  }
  if (!endereco && idCliente !== null) {
    const { data: lista } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, data_criacao")
      .eq("id_cliente", idCliente)
      .order("data_criacao", { ascending: false });
    const cepAlvo = String(frete?.cep ?? proposta.cep ?? "").replace(/\D/g, "");
    endereco =
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) ||
      (lista ?? [])[0] ||
      null;
  }
  if (!endereco || !endereco.cep) {
    return NextResponse.json(
      { success: false, message: "Pedido sem endereço de entrega com CEP — selecione o endereço no modal Despachar." },
      { status: 422 }
    );
  }

  const { data: cliente } = idCliente !== null
    ? await supabase.from("clientes").select("nome, fantasia, whatsapp_1, telefone_fixo").eq("id_cliente", idCliente).maybeSingle()
    : { data: null };

  // Remetente: empresa do pedido em public.empresas (fallback: primeira linha).
  const nomeEmpresa = String(proposta.empresa ?? "").trim();
  let empresaRow:
    | { razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null; telefone_nfe: string | null }
    | null = null;
  if (nomeEmpresa) {
    const { data } = await supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, cnpj, cep, logradouro, numero, complemento, bairro, municipio, uf, telefone_nfe")
      .or(`empresa.eq."${nomeEmpresa}",nome_fantasia.eq."${nomeEmpresa}",razao_social.eq."${nomeEmpresa}"`)
      .limit(1)
      .maybeSingle();
    empresaRow = data ?? null;
  }
  if (!empresaRow) {
    const { data } = await supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, cnpj, cep, logradouro, numero, complemento, bairro, municipio, uf, telefone_nfe")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    empresaRow = data ?? null;
  }
  if (!empresaRow?.cnpj || !empresaRow?.cep) {
    return NextResponse.json(
      { success: false, message: "Cadastro da empresa remetente sem CNPJ/CEP em public.empresas." },
      { status: 422 }
    );
  }

  const pesoGramas = exp?.peso_kg ? Number(exp.peso_kg) * 1000 : Number(frete?.peso) || 300;

  try {
    const resultado = await criarPrepostagem({
      servico,
      pesoGramas,
      alturaCm: Number(frete?.altura) || 10,
      larguraCm: Number(frete?.largura) || 20,
      comprimentoCm: Number(frete?.comprimento) || 25,
      remetente: {
        nome: empresaRow.nome_fantasia || empresaRow.razao_social || nomeEmpresa,
        cnpj: empresaRow.cnpj,
        cep: empresaRow.cep,
        logradouro: empresaRow.logradouro || "",
        numero: empresaRow.numero || "S/N",
        complemento: empresaRow.complemento || "",
        bairro: empresaRow.bairro || "",
        cidade: empresaRow.municipio || "",
        uf: empresaRow.uf || "",
        telefone: empresaRow.telefone_nfe || ""
      },
      destinatario: {
        nome: String(proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido ${idInt}`),
        cep: String(endereco.cep),
        logradouro: String(endereco.endereco ?? ""),
        numero: String(endereco.numero ?? "S/N"),
        complemento: String(endereco.complemento ?? ""),
        bairro: String(endereco.bairro ?? ""),
        cidade: String(endereco.cidade ?? ""),
        uf: String(endereco.uf ?? ""),
        telefone: String(cliente?.whatsapp_1 ?? cliente?.telefone_fixo ?? "")
      }
    });

    // Grava na expedição e espelha o rastreio na OS (tolerante a falha no espelho).
    const { error: upErr } = await supabase.from("expedicoes").upsert(
      {
        id_int: idInt,
        correios_id_prepostagem: resultado.id,
        correios_codigo_objeto: resultado.codigoObjeto,
        codigo_rastreamento: resultado.codigoObjeto,
        tipo_frete: "CORREIOS",
        updated_at: new Date().toISOString()
      },
      { onConflict: "id_int" }
    );
    if (upErr) {
      return NextResponse.json(
        { success: false, message: `Prepostagem criada (${resultado.codigoObjeto}), mas falhou ao gravar no pedido: ${upErr.message}` },
        { status: 500 }
      );
    }
    const { error: osErr } = await supabase
      .from("propostas_os")
      .update({ codigo_rastreamento: resultado.codigoObjeto })
      .eq("id_int", idInt);
    if (osErr) console.warn("[correios/prepostagem] Falha ao espelhar rastreio na OS:", osErr);

    return NextResponse.json({ success: true, codigoObjeto: resultado.codigoObjeto });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido nos Correios.";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Rota do rótulo oficial**

Criar `src/app/api/expedicao/correios/etiqueta/route.ts` (auth idêntica à Task 15; permissão `expedicao.view`):

```ts
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { baixarRotuloPdf, correiosConfigurado } from "@/lib/correios/cws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respostaErro(request: Request, message: string, status: number) {
  const aceitaHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!aceitaHtml) return NextResponse.json({ success: false, message }, { status });
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Etiqueta Correios</title><body style="font-family:sans-serif;padding:2rem"><h1>Não foi possível gerar o rótulo</h1><p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  if (!correiosConfigurado()) return respostaErro(request, "Correios não configurados no servidor.", 503);
  const { searchParams } = new URL(request.url);
  const idInt = Number(searchParams.get("id_int"));
  if (!Number.isFinite(idInt) || idInt <= 0) return respostaErro(request, "Parâmetro id_int inválido.", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return respostaErro(request, "Sessão expirada. Faça login novamente.", 401);
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.view");
  if (!temPermissao) return respostaErro(request, "Sem permissão (expedicao.view).", 403);

  const { data: exp } = await supabase
    .from("expedicoes")
    .select("correios_id_prepostagem")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!exp?.correios_id_prepostagem) {
    return respostaErro(request, "Este pedido ainda não tem prepostagem dos Correios — gere no modal Despachar.", 422);
  }

  try {
    const pdf = await baixarRotuloPdf(exp.correios_id_prepostagem);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="correios_${idInt}.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    return respostaErro(request, e instanceof Error ? e.message : "Erro desconhecido nos Correios.", 502);
  }
}
```

- [ ] **Step 3: Client fino**

Criar `src/features/expedicao/services/correios.client.ts`:

```ts
import { getSupabaseClient } from "@/lib/supabase/client";

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

export async function correiosStatus(): Promise<{ configurado: boolean }> {
  try {
    const res = await fetch("/api/expedicao/correios/status");
    const data = (await res.json()) as { configurado?: boolean };
    return { configurado: data.configurado === true };
  } catch {
    return { configurado: false };
  }
}

export async function gerarPrepostagem(
  idInt: number,
  servico: "SEDEX" | "PAC"
): Promise<{ success: boolean; codigoObjeto?: string; errorMessage?: string }> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/correios/prepostagem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, servico })
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; codigoObjeto?: string; message?: string } | null;
    if (res.ok && data?.success && data.codigoObjeto) return { success: true, codigoObjeto: data.codigoObjeto };
    return { success: false, errorMessage: data?.message || `Falha (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Abre o rótulo oficial (mesmo desenho anti-popup do abrirEtiqueta). */
export async function abrirEtiquetaCorreios(idInt: number): Promise<{ success: boolean; errorMessage?: string }> {
  const url = `/api/expedicao/correios/etiqueta?id_int=${idInt}`;
  const win = typeof window !== "undefined" ? window.open(url, "_blank") : null;
  if (win) return { success: true };
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let message = `Falha ao gerar o rótulo (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        if (body?.message) message = String(body.message);
      } catch {
        // resposta sem JSON — mantém a mensagem genérica
      }
      return { success: false, errorMessage: message };
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `correios_${idInt}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { success: true };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro inesperado." };
  }
}
```

- [ ] **Step 4: Botões na UI**

1. `DespacharModal.tsx`: estado `const [correiosOk, setCorreiosOk] = useState(false);` + no `useEffect` existente `void correiosStatus().then((s) => { if (ativo) setCorreiosOk(s.configurado); });`. Abaixo do campo "Código de rastreio (manual)", quando `tipoEntrega === "TRANSPORTE" && tipoFrete === "CORREIOS" && correiosOk`:

```tsx
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={gerandoPrepostagem}
                  onClick={() => void handleGerarPrepostagem("SEDEX")}
                  className="rounded-2xl bg-[#0f9f9a] px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {gerandoPrepostagem ? "Gerando..." : "Gerar prepostagem SEDEX"}
                </button>
                <button
                  type="button"
                  disabled={gerandoPrepostagem}
                  onClick={() => void handleGerarPrepostagem("PAC")}
                  className="rounded-2xl border border-[#0f9f9a] px-4 py-2 text-xs font-bold text-[#0f9f9a] transition hover:bg-teal-50 disabled:opacity-50"
                >
                  PAC
                </button>
              </div>
```

com o handler (e estado `gerandoPrepostagem`):

```tsx
  const [gerandoPrepostagem, setGerandoPrepostagem] = useState(false);
  async function handleGerarPrepostagem(servico: "SEDEX" | "PAC") {
    if (gerandoPrepostagem) return;
    setGerandoPrepostagem(true);
    const res = await gerarPrepostagem(pedido.idInt, servico);
    setGerandoPrepostagem(false);
    if (res.success && res.codigoObjeto) {
      setCodigoRastreamento(res.codigoObjeto);
      showToast({ type: "success", title: "Prepostagem criada", description: `Rastreio ${res.codigoObjeto} preenchido.` });
    } else {
      showToast({ type: "error", title: "Correios recusaram a prepostagem", description: res.errorMessage });
    }
  }
```

2. `ExpedicaoPage.tsx`, menu ⋯ (após "Imprimir etiqueta 10x15"): item condicional

```tsx
                ...(p.expedicao?.correiosIdPrepostagem
                  ? [{
                      label: "Etiqueta Correios (oficial)",
                      onClick: () => {
                        void abrirEtiquetaCorreios(p.idInt).then((res) => {
                          if (!res.success) showToast({ type: "error", title: "Erro no rótulo", description: res.errorMessage });
                        });
                      }
                    }]
                  : []),
```

Imports correspondentes nos dois arquivos.

- [ ] **Step 5: Validar em HOMOLOGAÇÃO**

Pré-requisito: dono preencheu `.env.local` com `CORREIOS_AMBIENTE=homologacao` + credenciais. Roteiro:
1. `npx tsc --noEmit` + eslint: zero erros.
2. Modal Despachar de um pedido com endereço com CEP: "Gerar prepostagem SEDEX" → toast de sucesso e campo de rastreio preenchido com código `..BR`.
3. Conferir gravação: `SELECT correios_id_prepostagem, correios_codigo_objeto, codigo_rastreamento FROM expedicoes WHERE id_int = <ID>;` — os 3 preenchidos; `propostas_os.codigo_rastreamento` espelhado.
4. Menu ⋯ → "Etiqueta Correios (oficial)": PDF abre com datamatrix.
5. Erro proposital (CEP inválido no endereço): toast mostra a mensagem da API dos Correios.
6. SÓ DEPOIS de uma etiqueta real validada em homologação, o dono troca `CORREIOS_AMBIENTE=producao` (decisão dele, fora deste plano).

---

### Task 18: Documentação do módulo

**Files:**
- Create: `docs/business/EXPEDICAO.md`
- Modify: `docs/DOCUMENTATION_INDEX.md` (linha nova na seção de docs de negócio, apontando para EXPEDICAO.md)

**Interfaces:**
- Consumes: tudo acima (o doc descreve o implementado, não o planejado).

- [ ] **Step 1: Escrever `docs/business/EXPEDICAO.md`**

Conteúdo mínimo (seções e fatos; redigir em PT-BR corrido no padrão dos outros docs de `docs/business/`):
1. **O que é**: painel `/expedicao` — funil APROVADO→ENTREGUE, quem opera é o expedidor.
2. **Fontes de dados**: tabela por tabela (as 7 da Task 4) + precedências (peso aferido > cotado > teórico; rastreio expedicoes > propostas_os; tipo de frete expedicoes > normalização da cotação).
3. **Estados e transições**: o mapa da Task 8 (incluindo "Voltar status" e a guarda de concorrência) + os_status_log (`origem='EXPEDICAO_UI'`).
4. **Regra de NF**: alerta forte sem bloqueio; chip conta só de PRONTO em diante.
5. **Normalizador de tipo de frete**: as 6 categorias e exemplos reais; "SEM CUSTO ≠ retirada".
6. **Etiquetas**: interna 10×15 (rota, 1 página/volume, QR) e Correios (prepostagem, rótulo ET, envs, homologação→produção).
7. **Rastreio n8n**: webhook, formato `{sucesso, mensagem}`, fallback de texto bruto.
8. **Permissões**: `expedicao.view` / `expedicao.operar` (+fallback admin).
9. **Decisões de 15/08/2026**: entrada pelo expedidor; tabela `expedicoes`; etiqueta 10×15; NF não bloqueia.

- [ ] **Step 2: Indexar**

Adicionar a linha em `docs/DOCUMENTATION_INDEX.md` na listagem de documentos de negócio (mesmo formato das existentes).

- [ ] **Step 3: Validar**

Reler o doc contra o código implementado (grep dos nomes citados: `listarPainelExpedicao`, `expedicoes`, `EXPEDICAO_UI`, rotas API). Cada afirmação do doc precisa existir no código.

---

## Auto-review (feito na escrita do plano)

- **Cobertura do spec:** §4 tela → Tasks 5–7, 9; §5 dados → Tasks 1, 3, 4; §6 transições → Task 8; §7 etiqueta térmica → Tasks 14–15; §8 Correios → Tasks 16–17; §8.1 rastreio n8n → Task 13; §9 permissões → Tasks 6, 7, 15, 17; §10 limpeza → Tasks 2, 4, 5; §11 fases → estrutura do plano; §12 validação → steps de cada task; docs → Tasks 1 (matriz) e 18.
- **Divergência consciente do spec:** o spec fala "seletor global de Empresa"; não existe seletor global no código — o filtro de empresa segue o padrão real da Fila Geral (`emp` na URL, opções derivadas dos dados). Registrado no spec como acréscimo desta revisão.
- **Sem placeholders:** todo step de código tem o código; os dois pontos externos com contrato incerto (payload CWS, campos de `MockUser`) têm passo explícito de verificação + critério de ajuste.
- **Consistência de tipos:** `PedidoExpedicao`/`ExpedicaoRegistro` definidos na Task 3 e usados por 4, 6, 8–15; `AtorExpedicao`/`DespachoInput`/`ResultadoAcao` definidos na Task 8 e usados por 9–11; `EtiquetaViewModel` definido na Task 14 e usado na 15.


