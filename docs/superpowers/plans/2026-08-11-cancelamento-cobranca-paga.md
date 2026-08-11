# Cancelamento de Cobrança Paga — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um super admin cancele uma cobrança já paga na Conferência de Pagamentos, com motivo de catálogo, destino definido para o valor recebido e trilha de auditoria.

**Architecture:** Uma rota nova e isolada (`POST /api/cobrancas/cancelar-pago`) concentra as regras do caso excepcional, sem tocar em `cancelar-externo` nem em `cancelar-boleto`. As decisões puras (catálogo de motivos, destino sugerido, status que bloqueiam, detecção de mês fechado) vivem num módulo sem I/O, testável isoladamente. A UI reaproveita o modal existente e passa a rotear para a rota nova quando a cobrança estiver paga.

**Tech Stack:** Next.js App Router (route handlers), TypeScript, Supabase JS, Tailwind. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md`

## Global Constraints

- **PT-BR** em todo texto de UI, comentário, mensagem de erro e documentação.
- **Nenhuma dependência nova** no `package.json`.
- **Nenhuma alteração** em `src/app/api/cobrancas/cancelar-externo/route.ts` nem em `src/app/api/cobrancas/cancelar-boleto/route.ts` — a trava que protege as 6.021 cobranças pagas continua de pé.
- **Nenhuma alteração de schema, trigger, RLS ou RPC.** Só se usa o que já existe em produção.
- **Sem chamada a provedor externo** neste fluxo.
- Validação de cada task: `npx tsc --noEmit` sem erros e `npx eslint <arquivos>` sem problemas novos em relação ao HEAD (comparar com `git show HEAD:<arquivo> | npx eslint --stdin --stdin-filename <arquivo>`).
- Mensagem de commit em ASCII, sem acentos e **sem aspas duplas** (PowerShell 5.1 quebra) — usar here-string `@'...'@`.
- Não commitar `.env.local`. Rascunhos vão em `scratch/` (já ignorada).

### Sobre testes neste repositório

Não existe runner de testes unitários: o `package.json` tem só `@playwright/test` como devDependency e nenhum script `test`. Introduzir Jest/Vitest está **fora do escopo** deste plano.

A estratégia é a que o projeto já pratica e que funciona sem dependência nova:

- **Lógica pura** (Task 1): arquivo `.test.mjs` executável com `node`, com asserts próprios e código de saída — TDD de verdade, sem framework.
- **Rota e UI**: `tsc` + `eslint` + roteiro de cenários manuais em localhost, listados na Task 6.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/features/cobrancas/cancelamento-pago.ts` *(novo)* | Regras puras: catálogo de motivos, destino sugerido, status que bloqueiam, detecção de mês fechado, montagem do texto de `motivo_cancela`. Sem I/O, sem React. |
| `scratch/cancelamento-pago.test.mjs` *(novo, não versionado)* | Testes executáveis das regras puras. |
| `src/app/api/cobrancas/cancelar-pago/route.ts` *(novo)* | Autorização, revalidação, bloqueios, escrita e auditoria. |
| `src/features/cobrancas/CancelCobrancaModal.tsx` *(modificar)* | Select de motivo, destino do valor e confirmação de mês fechado. |
| `src/features/cobrancas/CobrancasProvider.tsx` *(modificar)* | Rotear cobrança paga para a rota nova em vez de barrar. |
| `docs/business/CANCELAMENTO-COBRANCAS.md` *(modificar)* | Descrever a exceção autorizada. |
| `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` *(modificar)* | Registrar a operação autorizada. |
| `docs/business/CONTA-CORRENTE-FASE-1-PREPARACAO.md` *(modificar)* | Corrigir o status "não aplicada". |

---

### Task 1: Regras puras do cancelamento pago

**Files:**
- Create: `src/features/cobrancas/cancelamento-pago.ts`
- Test: `scratch/cancelamento-pago.test.mjs`

**Interfaces:**
- Consumes: `PROPOSTA_STATUS_PROTEGIDOS` de `src/features/orcamentos/services/status-protegidos.ts`; `getLocalMonthKey` de `src/features/cobrancas/cobrancas-utils.ts`.
- Produces:
  - `type MotivoCancelamentoPago = "DESISTENCIA_CLIENTE" | "ENGANO_MODALIDADE" | "COBRANCA_DUPLICADA" | "VALOR_INCORRETO" | "OUTRO"`
  - `type DestinoValorCancelado = "DEVOLVIDO" | "CREDITO" | "NENHUM"`
  - `MOTIVOS_CANCELAMENTO_PAGO: { codigo: MotivoCancelamentoPago; rotulo: string; destinoSugerido: DestinoValorCancelado; exigeTexto: boolean }[]`
  - `DESTINOS_VALOR_CANCELADO: { codigo: DestinoValorCancelado; rotulo: string }[]`
  - `isMotivoCancelamentoPago(valor: unknown): valor is MotivoCancelamentoPago`
  - `isDestinoValorCancelado(valor: unknown): valor is DestinoValorCancelado`
  - `bloqueiaCancelamentoPago(statusProposta: string | null | undefined): boolean`
  - `mensagemBloqueioProducao(idInt: number | null, statusProposta: string): string`
  - `isConfirmacaoDeMesAnterior(dataConfirmacao: string | null | undefined, agora?: Date): boolean`
  - `rotuloMotivo(motivo: MotivoCancelamentoPago): string`
  - `montarMotivoCancela(motivo: MotivoCancelamentoPago, texto: string | null, destino: DestinoValorCancelado): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `scratch/cancelamento-pago.test.mjs`. O módulo é `.ts`, então o teste importa uma cópia transpilada não — em vez disso o teste importa o próprio arquivo via `tsx`? **Não**: para não introduzir dependência, o teste replica a chamada usando `node --experimental-strip-types`, disponível no Node 24 instalado neste ambiente (`node -v` → v24.x).

```js
// scratch/cancelamento-pago.test.mjs
import {
  MOTIVOS_CANCELAMENTO_PAGO,
  bloqueiaCancelamentoPago,
  isConfirmacaoDeMesAnterior,
  montarMotivoCancela,
  mensagemBloqueioProducao
} from "../src/features/cobrancas/cancelamento-pago.ts";

let falhas = 0;
const checar = (nome, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FALHA | ${nome}\n  obtido=${JSON.stringify(obtido)}\n  esperado=${JSON.stringify(esperado)}`); }
  else console.log(`OK    | ${nome}`);
};

// Catalogo
checar("catalogo tem 5 motivos", MOTIVOS_CANCELAMENTO_PAGO.length, 5);
checar("desistencia sugere devolucao",
  MOTIVOS_CANCELAMENTO_PAGO.find(m => m.codigo === "DESISTENCIA_CLIENTE").destinoSugerido, "DEVOLVIDO");
checar("engano de modalidade sugere nenhum",
  MOTIVOS_CANCELAMENTO_PAGO.find(m => m.codigo === "ENGANO_MODALIDADE").destinoSugerido, "NENHUM");
checar("valor incorreto sugere nenhum",
  MOTIVOS_CANCELAMENTO_PAGO.find(m => m.codigo === "VALOR_INCORRETO").destinoSugerido, "NENHUM");
checar("duplicada sugere devolucao",
  MOTIVOS_CANCELAMENTO_PAGO.find(m => m.codigo === "COBRANCA_DUPLICADA").destinoSugerido, "DEVOLVIDO");
checar("so OUTRO exige texto",
  MOTIVOS_CANCELAMENTO_PAGO.filter(m => m.exigeTexto).map(m => m.codigo), ["OUTRO"]);

// Bloqueio por status da proposta
checar("EM PRODUCAO bloqueia", bloqueiaCancelamentoPago("EM PRODUCAO"), true);
checar("EM IMPRESSAO bloqueia", bloqueiaCancelamentoPago("EM IMPRESSAO"), true);
checar("ENTREGUE bloqueia", bloqueiaCancelamentoPago("ENTREGUE"), true);
checar("LIBERADO bloqueia", bloqueiaCancelamentoPago("LIBERADO"), true);
checar("REVISAO ATENDENTE LIBERA", bloqueiaCancelamentoPago("REVISAO ATENDENTE"), false);
checar("minusculo e espaco tambem bloqueiam", bloqueiaCancelamentoPago("  em producao  "), true);
checar("NOVO nao bloqueia", bloqueiaCancelamentoPago("NOVO"), false);
checar("AGUARDANDO nao bloqueia", bloqueiaCancelamentoPago("AGUARDANDO"), false);
checar("nulo nao bloqueia", bloqueiaCancelamentoPago(null), false);

// Mensagem acionavel
checar("mensagem cita proposta, status e a saida",
  mensagemBloqueioProducao(20493, "EM PRODUCAO"),
  "Proposta 20493 esta EM PRODUCAO. Peca ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobranca.");

// Mes fechado (America/Sao_Paulo)
const agosto = new Date("2026-08-20T12:00:00-03:00");
checar("mesmo mes nao e anterior", isConfirmacaoDeMesAnterior("2026-08-03T10:00:00-03:00", agosto), false);
checar("mes anterior e anterior", isConfirmacaoDeMesAnterior("2026-07-31T10:00:00-03:00", agosto), true);
checar("virada de fuso: 01/08 02:00Z ainda e julho em SP",
  isConfirmacaoDeMesAnterior("2026-08-01T02:00:00Z", agosto), true);
checar("sem data nao e anterior", isConfirmacaoDeMesAnterior(null, agosto), false);

// Texto gravado em motivo_cancela
checar("motivo de catalogo",
  montarMotivoCancela("DESISTENCIA_CLIENTE", null, "DEVOLVIDO"),
  "Desistencia do cliente | Valor devolvido ao cliente");
checar("motivo OUTRO carrega o texto",
  montarMotivoCancela("OUTRO", "erro de conciliacao do banco", "CREDITO"),
  "Outro motivo: erro de conciliacao do banco | Valor lancado como credito na conta corrente");
checar("destino nenhum",
  montarMotivoCancela("ENGANO_MODALIDADE", null, "NENHUM"),
  "Engano de modalidade | Valor mantido (cobranca sera refeita)");

console.log(falhas === 0 ? "\nTODOS OS CASOS PASSARAM" : `\n${falhas} CASO(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --experimental-strip-types scratch/cancelamento-pago.test.mjs`
Expected: FALHA com `Cannot find module ... cancelamento-pago.ts`.

Se o `--experimental-strip-types` não existir nesta versão do Node, **pare e reporte** em vez de adicionar dependência: a alternativa aceita é escrever o módulo em `.ts` e o teste importando uma cópia manual das funções (como já foi feito em `scratch/prazo-boletim.test.mjs`), declarando isso no relatório.

- [ ] **Step 3: Escrever o módulo**

```ts
// src/features/cobrancas/cancelamento-pago.ts
/**
 * Regras puras do cancelamento de cobranca JA PAGA (Conferencia de Pagamentos).
 * Sem I/O e sem React de proposito: a rota e a tela consomem daqui, e o
 * comportamento fica testavel isoladamente.
 *
 * Spec: docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md
 */
import { PROPOSTA_STATUS_PROTEGIDOS } from "@/features/orcamentos/services/status-protegidos";
import { getLocalMonthKey } from "@/features/cobrancas/cobrancas-utils";

export type MotivoCancelamentoPago =
  | "DESISTENCIA_CLIENTE"
  | "ENGANO_MODALIDADE"
  | "COBRANCA_DUPLICADA"
  | "VALOR_INCORRETO"
  | "OUTRO";

export type DestinoValorCancelado = "DEVOLVIDO" | "CREDITO" | "NENHUM";

export const MOTIVOS_CANCELAMENTO_PAGO: {
  codigo: MotivoCancelamentoPago;
  rotulo: string;
  destinoSugerido: DestinoValorCancelado;
  exigeTexto: boolean;
}[] = [
  { codigo: "DESISTENCIA_CLIENTE", rotulo: "Desistencia do cliente", destinoSugerido: "DEVOLVIDO", exigeTexto: false },
  { codigo: "ENGANO_MODALIDADE", rotulo: "Engano de modalidade", destinoSugerido: "NENHUM", exigeTexto: false },
  { codigo: "COBRANCA_DUPLICADA", rotulo: "Cobranca duplicada", destinoSugerido: "DEVOLVIDO", exigeTexto: false },
  { codigo: "VALOR_INCORRETO", rotulo: "Valor incorreto", destinoSugerido: "NENHUM", exigeTexto: false },
  { codigo: "OUTRO", rotulo: "Outro motivo", destinoSugerido: "DEVOLVIDO", exigeTexto: true }
];

export const DESTINOS_VALOR_CANCELADO: { codigo: DestinoValorCancelado; rotulo: string }[] = [
  { codigo: "DEVOLVIDO", rotulo: "Valor devolvido ao cliente" },
  { codigo: "CREDITO", rotulo: "Valor lancado como credito na conta corrente" },
  { codigo: "NENHUM", rotulo: "Valor mantido (cobranca sera refeita)" }
];

export function isMotivoCancelamentoPago(valor: unknown): valor is MotivoCancelamentoPago {
  return MOTIVOS_CANCELAMENTO_PAGO.some((m) => m.codigo === valor);
}

export function isDestinoValorCancelado(valor: unknown): valor is DestinoValorCancelado {
  return DESTINOS_VALOR_CANCELADO.some((d) => d.codigo === valor);
}

/**
 * Status operacionais que impedem o cancelamento. E a lista protegida MENOS
 * REVISAO ATENDENTE: esse status e justamente a porta de saida — o gerente
 * devolve a proposta para la (devolverPropostaParaRevisaoAtendente, tela de
 * Pedidos) e so entao o financeiro cancela.
 */
export const STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO: readonly string[] =
  PROPOSTA_STATUS_PROTEGIDOS.filter((status) => status !== "REVISAO ATENDENTE");

export function bloqueiaCancelamentoPago(statusProposta: string | null | undefined): boolean {
  const normalizado = String(statusProposta || "").trim().toUpperCase();
  if (!normalizado) return false;
  return STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO.includes(normalizado);
}

export function mensagemBloqueioProducao(idInt: number | null, statusProposta: string): string {
  const proposta = idInt != null ? `Proposta ${idInt}` : "A proposta";
  return `${proposta} esta ${String(statusProposta).trim().toUpperCase()}. ` +
    "Peca ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobranca.";
}

/**
 * A confirmacao caiu em mes anterior ao corrente (America/Sao_Paulo)? E o
 * unico caso em que um faturamento ja fechado muda, e por isso exige
 * confirmacao extra do usuario.
 */
export function isConfirmacaoDeMesAnterior(
  dataConfirmacao: string | null | undefined,
  agora: Date = new Date()
): boolean {
  if (!dataConfirmacao) return false;
  const mesConfirmacao = getLocalMonthKey(dataConfirmacao);
  const mesAtual = getLocalMonthKey(agora.toISOString());
  if (!mesConfirmacao || !mesAtual) return false;
  return mesConfirmacao < mesAtual;
}

export function rotuloMotivo(motivo: MotivoCancelamentoPago): string {
  return MOTIVOS_CANCELAMENTO_PAGO.find((m) => m.codigo === motivo)?.rotulo ?? String(motivo);
}

/** Texto unico gravado em pagamentos_v2.motivo_cancela. */
export function montarMotivoCancela(
  motivo: MotivoCancelamentoPago,
  texto: string | null,
  destino: DestinoValorCancelado
): string {
  const base = motivo === "OUTRO"
    ? `${rotuloMotivo(motivo)}: ${String(texto || "").trim()}`
    : rotuloMotivo(motivo);
  const destinoRotulo = DESTINOS_VALOR_CANCELADO.find((d) => d.codigo === destino)?.rotulo ?? destino;
  return `${base} | ${destinoRotulo}`;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --experimental-strip-types scratch/cancelamento-pago.test.mjs`
Expected: `TODOS OS CASOS PASSARAM`, exit 0.

Se `getLocalMonthKey` não aceitar uma string ISO com offset, ajustar o teste **e** o módulo para usar a mesma normalização que `CobrancasList` já faz, e registrar o ajuste no relatório.

- [ ] **Step 5: Typecheck e lint**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx eslint src/features/cobrancas/cancelamento-pago.ts`
Expected: sem saída.

- [ ] **Step 6: Commit**

```bash
git add src/features/cobrancas/cancelamento-pago.ts
git commit -m @'
feat(cobrancas): regras puras do cancelamento de cobranca paga

Catalogo de motivos com destino sugerido, lista de status que bloqueiam
(protegidos menos REVISAO ATENDENTE, que e a porta de saida), deteccao de
confirmacao em mes anterior e montagem do texto de motivo_cancela.
Modulo sem I/O, coberto por scratch/cancelamento-pago.test.mjs.
'@
```

---

### Task 2: Rota `POST /api/cobrancas/cancelar-pago`

**Files:**
- Create: `src/app/api/cobrancas/cancelar-pago/route.ts`
- Ler antes (não modificar): `src/app/api/cobrancas/cancelar-externo/route.ts` linhas 150-210 — é de lá que sai o padrão de construção do client e de leitura da sessão.

**Interfaces:**
- Consumes: tudo que a Task 1 produz.
- Produces: contrato HTTP consumido pela Task 4.
  - Sucesso: `{ success: true, alreadyCancelled?: boolean, id_movimento_credito?: number }`
  - Erro: `{ success: false, code: string, message: string }` com `code` ∈ `NEGADO | NAO_ENCONTRADA | NAO_PAGA | PRODUCAO_ATIVA | MES_FECHADO | MOTIVO_INVALIDO | FALHA_CREDITO`

- [ ] **Step 1: Ler o padrão da rota existente**

Run: `sed -n '150,210p' src/app/api/cobrancas/cancelar-externo/route.ts`

Anotar: como o token é extraído do header, como o client é construído e qual client é usado para escrever. A rota nova deve usar **o mesmo padrão** — não inventar outro.

- [ ] **Step 2: Escrever a rota**

```ts
// src/app/api/cobrancas/cancelar-pago/route.ts
/**
 * Cancelamento de cobranca JA PAGA — caso excepcional, restrito a super admin.
 *
 * Por que uma rota separada: cancelar-externo e cancelar-boleto existem para
 * orquestrar o provedor e recusam cobranca paga, protegendo milhares de
 * registros. Cobranca paga nao tem titulo em aberto para baixar no provedor
 * (o PIX ja caiu, o boleto ja liquidou) — a devolucao acontece por fora do
 * ERP. Entao este fluxo e 100% local e nasce isolado, sem afrouxar aquela
 * trava.
 *
 * Spec: docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  bloqueiaCancelamentoPago,
  isConfirmacaoDeMesAnterior,
  isDestinoValorCancelado,
  isMotivoCancelamentoPago,
  mensagemBloqueioProducao,
  montarMotivoCancela,
  rotuloMotivo
} from "@/features/cobrancas/cancelamento-pago";

const STATUS_INATIVOS = ["CANCELADO", "EXTORNADO", "RECUSADO"];

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const id = body?.id ? String(body.id) : "";
    const motivo = body?.motivo;
    const motivoTexto = body?.motivo_texto ? String(body.motivo_texto).trim() : "";
    const destino = body?.destino_valor;
    const confirmaMesFechado = body?.confirma_mes_fechado === true;

    if (!id) return erro("NAO_ENCONTRADA", "Cobranca nao informada.", 400);
    if (!isMotivoCancelamentoPago(motivo)) return erro("MOTIVO_INVALIDO", "Selecione um motivo de cancelamento.", 400);
    if (!isDestinoValorCancelado(destino)) return erro("MOTIVO_INVALIDO", "Selecione o destino do valor.", 400);
    if (motivo === "OUTRO" && !motivoTexto) {
      return erro("MOTIVO_INVALIDO", "Descreva o motivo do cancelamento.", 400);
    }

    // 1. Sessao — mesmo padrao de cancelar-externo.
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return erro("NEGADO", "Sessao invalida.", 401);

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return erro("NEGADO", "Sessao invalida.", 401);

    // 2. SO super admin. verificarPermissaoServerSide nao serve aqui: ela
    //    tambem aprova perfil que tenha a permissao, e a decisao do dono foi
    //    restringir a super admin.
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("is_super_adm")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (!usuario?.is_super_adm) {
      return erro("NEGADO", "Somente um super administrador pode cancelar uma cobranca ja paga.", 403);
    }

    // 3. Reconsulta a cobranca: o id e a unica informacao de confianca.
    const { data: pagamento, error: pagamentoError } = await supabase
      .from("pagamentos_v2")
      .select("id, id_int, id_cliente, valor, status, confirmado, paid_at, data_confirmacao, tipo_cobranca")
      .eq("id", id)
      .maybeSingle();

    if (pagamentoError || !pagamento) {
      return erro("NAO_ENCONTRADA", "Cobranca nao encontrada.", 409);
    }

    const statusAtual = String(pagamento.status || "").trim().toUpperCase();

    // 4. Idempotencia: ja inativa e no-op.
    if (STATUS_INATIVOS.includes(statusAtual)) {
      return NextResponse.json({ success: true, alreadyCancelled: true });
    }

    // 5. Esta rota e SO para o caso excepcional da cobranca paga.
    const estaPaga = statusAtual === "PAID" || pagamento.confirmado === true
      || pagamento.paid_at != null || pagamento.data_confirmacao != null;
    if (!estaPaga) {
      return erro("NAO_PAGA", "Esta cobranca nao esta paga. Use o cancelamento normal.", 409);
    }

    // 6. Producao ativa bloqueia.
    if (pagamento.id_int != null) {
      const { data: proposta } = await supabase
        .from("propostas")
        .select("status_interno")
        .eq("id_int", pagamento.id_int)
        .maybeSingle();

      const statusProposta = String(proposta?.status_interno || "");
      if (bloqueiaCancelamentoPago(statusProposta)) {
        return erro("PRODUCAO_ATIVA", mensagemBloqueioProducao(Number(pagamento.id_int), statusProposta), 409);
      }
    }

    // 7. Faturamento ja fechado exige confirmacao explicita.
    const referencia = pagamento.data_confirmacao || pagamento.paid_at;
    if (isConfirmacaoDeMesAnterior(referencia) && !confirmaMesFechado) {
      return erro("MES_FECHADO", "Esta cobranca foi confirmada em mes anterior. Confirme que o faturamento fechado sera alterado.", 409);
    }

    // 8. Credito ANTES do cancelamento: se a conta corrente falhar, nada e
    //    gravado e a cobranca continua paga. Nunca pode existir cobranca
    //    cancelada sem o credito prometido.
    let idMovimentoCredito: number | null = null;
    if (destino === "CREDITO") {
      if (pagamento.id_cliente == null) {
        return erro("FALHA_CREDITO", "Cobranca sem cliente vinculado: nao e possivel lancar credito.", 409);
      }
      const { data: movimento, error: creditoError } = await supabase.rpc("mc_ajuste_avulso_criar", {
        p_id_cliente: pagamento.id_cliente,
        p_tipo: "CREDITO",
        p_valor: Number(pagamento.valor),
        p_observacao: `Cancelamento da cobranca ${pagamento.id} (proposta ${pagamento.id_int}) - ${rotuloMotivo(motivo)}`,
        // A chave e o proprio id da cobranca: repetir a operacao nao gera
        // credito em dobro.
        p_chave_idempotencia: pagamento.id
      });

      if (creditoError) {
        return erro("FALHA_CREDITO", `Nao foi possivel lancar o credito na conta corrente: ${creditoError.message}`, 409);
      }
      idMovimentoCredito = typeof movimento === "number" ? movimento : null;
    }

    // 9. Cancelamento local.
    const motivoCancela = montarMotivoCancela(motivo, motivoTexto || null, destino);
    const { error: updateError } = await supabase
      .from("pagamentos_v2")
      .update({ status: "CANCELADO", motivo_cancela: motivoCancela })
      .eq("id", pagamento.id);

    if (updateError) {
      return erro("NAO_ENCONTRADA", `Falha ao cancelar a cobranca: ${updateError.message}`, 409);
    }

    return NextResponse.json({
      success: true,
      ...(idMovimentoCredito != null ? { id_movimento_credito: idMovimentoCredito } : {})
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : "erro desconhecido";
    console.error("[cancelar-pago] falha inesperada:", detalhe);
    return erro("NAO_ENCONTRADA", "Falha inesperada ao cancelar a cobranca.", 500);
  }
}
```

- [ ] **Step 3: Conferir o retorno real da RPC**

Run (leitura, via MCP do Supabase):

```sql
select pg_get_function_result(p.oid) as retorno
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'mc_ajuste_avulso_criar';
```

Se a RPC **não** devolver um id numérico, remover `id_movimento_credito` do contrato (Step 2, bloco final) em vez de devolver `null` — a spec §4 já prevê isso.

- [ ] **Step 4: Conferir o histórico**

Verificar como `cancelar-externo` grava o histórico do cancelamento (autor real) e replicar aqui, gravando também o destino do valor.

Run: `grep -n "historico\|propostas_chat\|timeline" src/app/api/cobrancas/cancelar-externo/route.ts`

Implementar o mesmo registro nesta rota, logo após o Step 2 item 9. Se a gravação do histórico falhar, **não** reverter o cancelamento: registrar `console.error` e seguir — o cancelamento já é fato e o motivo está em `motivo_cancela`.

- [ ] **Step 5: Typecheck e lint**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx eslint src/app/api/cobrancas/cancelar-pago/route.ts`
Expected: sem saída.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cobrancas/cancelar-pago/route.ts
git commit -m @'
feat(cobrancas): rota de cancelamento de cobranca paga restrita a super admin

Rota nova e isolada: cancelar-externo e cancelar-boleto nao sao tocadas.
Sem chamada a provedor (cobranca paga nao tem titulo em aberto). Valida super
admin pelo is_super_adm, reconsulta a cobranca, recusa cobranca nao paga,
bloqueia proposta em producao apontando a devolucao para REVISAO ATENDENTE e
exige confirmacao quando a confirmacao for de mes anterior. O credito na conta
corrente e lancado antes do cancelamento para nunca sobrar cobranca cancelada
sem o credito prometido.
'@
```

---

### Task 3: Modal com motivo de catálogo, destino e confirmação

**Files:**
- Modify: `src/features/cobrancas/CancelCobrancaModal.tsx`

**Interfaces:**
- Consumes: `MOTIVOS_CANCELAMENTO_PAGO`, `DESTINOS_VALOR_CANCELADO`, tipos da Task 1.
- Produces: o `onConfirm` do modal passa a receber um objeto em vez de string:
  `onConfirm(dados: { motivo: MotivoCancelamentoPago; motivoTexto: string; destino: DestinoValorCancelado; confirmaMesFechado: boolean }) => void`
  Novas props: `isCobrancaPaga: boolean`, `mesFechadoLabel: string | null` (ex.: `"agosto/2026"`; `null` quando não for mês anterior).

- [ ] **Step 1: Ler o modal inteiro**

Run: `cat src/features/cobrancas/CancelCobrancaModal.tsx`

São ~135 linhas. Entender as props atuais e quem chama antes de mudar a assinatura.

- [ ] **Step 2: Alterar o modal**

Regras a implementar, mantendo o visual atual (mesmo cabeçalho, mesmo bloco vermelho de aviso, mesmos botões):

1. Quando `isCobrancaPaga === false`: comportamento de hoje, textarea livre. Nada muda para o fluxo antigo.
2. Quando `isCobrancaPaga === true`:
   - `<select>` "Motivo do Cancelamento *" com as opções de `MOTIVOS_CANCELAMENTO_PAGO` (`rotulo` como texto, `codigo` como value).
   - Ao trocar o motivo, marcar automaticamente o `destinoSugerido` correspondente.
   - Textarea só aparece quando o motivo selecionado tem `exigeTexto`.
   - Grupo de rádios "Destino do valor" com `DESTINOS_VALOR_CANCELADO`.
   - Quando `mesFechadoLabel` não for nulo, checkbox obrigatório: `Entendo que o faturamento de {mesFechadoLabel} sera alterado.`
   - Botão "Confirmar Cancelamento" desabilitado enquanto: motivo vazio, ou (`exigeTexto` e texto vazio), ou (`mesFechadoLabel` e checkbox desmarcado).

Comentário obrigatório no arquivo explicando por que existem dois modos:

```tsx
// Dois modos de proposito: cobranca NAO paga segue com motivo livre (fluxo de
// sempre); cobranca paga exige motivo de catalogo + destino do valor, porque e
// operacao excepcional de super admin que mexe em receita ja reconhecida.
```

- [ ] **Step 3: Typecheck e lint**

Run: `npx tsc --noEmit`
Expected: sem erros. Se o chamador antigo quebrar por causa da nova assinatura de `onConfirm`, corrigir na Task 4 — **é esperado que o typecheck acuse aqui**; nesse caso siga para a Task 4 e só então rode o typecheck limpo.

Run: `npx eslint src/features/cobrancas/CancelCobrancaModal.tsx`
Expected: sem problemas novos em relação ao HEAD.

- [ ] **Step 4: Commit (junto com a Task 4)**

O modal e o chamador mudam juntos; o commit acontece no fim da Task 4 para não deixar a árvore quebrada.

---

### Task 4: Rotear cobrança paga para a rota nova

**Files:**
- Modify: `src/features/cobrancas/CobrancasProvider.tsx` (guard em `cancelCobranca`, hoje por volta da linha 1113)
- Modify: quem monta o `CancelCobrancaModal` na Conferência (localizar com o grep do Step 1)

**Interfaces:**
- Consumes: contrato HTTP da Task 2 e as props novas da Task 3.
- Produces: `cancelCobranca` passa a aceitar os dados do cancelamento pago e a devolver `{ success, errorMessage?, code? }`, mantendo a assinatura antiga funcionando para cobrança não paga.

- [ ] **Step 1: Localizar os chamadores**

Run: `grep -rn "CancelCobrancaModal\|cancelCobranca(" src/`

- [ ] **Step 2: Alterar o guard do provider**

Em `CobrancasProvider.cancelCobranca`, o trecho que hoje devolve
`"Não é permitido cancelar cobrança paga ou com faturamento aprovado (A_VENCER)."`
passa a bifurcar:

```ts
// Cobranca paga tem fluxo proprio: rota dedicada, so super admin, motivo de
// catalogo e destino do valor. O guard antigo continua valendo para tudo que
// nao for paga.
if (dbStatusNorm === "PAID" || dbStatusNorm === "A_VENCER") {
  if (!dadosPago) {
    return { success: false, errorMessage: "Não é permitido cancelar cobrança paga ou com faturamento aprovado (A_VENCER)." };
  }
  return await cancelarCobrancaPaga(id, dadosPago);
}
```

`cancelarCobrancaPaga` faz `POST /api/cobrancas/cancelar-pago` com o token da sessão e devolve `code` junto do `errorMessage`, para a tela escolher a mensagem.

- [ ] **Step 3: Ligar a tela**

Quem abre o modal passa `isCobrancaPaga` e `mesFechadoLabel` (calculado com `isConfirmacaoDeMesAnterior` + formatação `mês/ano` em PT-BR) e repassa o objeto do `onConfirm` para `cancelCobranca`.

Quando a resposta trouxer `code === "NEGADO"`, exibir o alerta NEGADO no modal de alerta já padronizado, e não um toast.

- [ ] **Step 4: Typecheck e lint**

Run: `npx tsc --noEmit`
Expected: sem erros — agora sim, com modal e chamador alinhados.

Run: `npx eslint src/features/cobrancas/CancelCobrancaModal.tsx src/features/cobrancas/CobrancasProvider.tsx`
Expected: sem problemas novos em relação ao HEAD.

- [ ] **Step 5: Commit**

```bash
git add src/features/cobrancas/CancelCobrancaModal.tsx src/features/cobrancas/CobrancasProvider.tsx
git commit -m @'
feat(conferencia): modal de cancelamento com motivo de catalogo e destino do valor

Cobranca nao paga segue igual, com motivo livre. Cobranca paga passa a exigir
motivo de catalogo, destino do valor e, quando a confirmacao for de mes
anterior, uma confirmacao explicita de que o faturamento fechado muda. O
provider deixa de barrar a cobranca paga e roteia para a rota dedicada.
'@
```

---

### Task 5: Documentação

**Files:**
- Modify: `docs/business/CANCELAMENTO-COBRANCAS.md`
- Modify: `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- Modify: `docs/business/CONTA-CORRENTE-FASE-1-PREPARACAO.md`

- [ ] **Step 1: `CANCELAMENTO-COBRANCAS.md`**

Na seção "Validações Obrigatórias no Backend", onde hoje se lê que a cobrança não pode ser cancelada quando `status = PAID`, acrescentar a exceção — sem enfraquecer a regra geral:

> **Exceção autorizada (11/08/2026): cancelamento de cobrança paga.**
> Restrito a super admin, pela rota `POST /api/cobrancas/cancelar-pago`, com motivo de catálogo e destino definido para o valor. Não passa por provedor externo, porque cobrança paga não tem título em aberto. Bloqueado quando a proposta está em status operacional (exceto `REVISAO ATENDENTE`) e exige confirmação explícita quando a confirmação for de mês anterior. As rotas `cancelar-externo` e `cancelar-boleto` continuam recusando cobrança paga.

Deixar explícito que essa rota **é** o ponto oficial desse caso, para não ser lida como o "cancelamento paralelo" que o próprio documento proíbe.

- [ ] **Step 2: Matriz de Segurança**

Acrescentar linha para `public.pagamentos_v2` / `status`, `motivo_cancela` / `UPDATE` / `LIBERADO` / restrito a super admin via `/api/cobrancas/cancelar-pago`, com a consulta de validação:

```sql
select id, status, motivo_cancela, paid_at, data_confirmacao
from public.pagamentos_v2 where id = :id;
```

- [ ] **Step 3: Corrigir a divergência da Conta Corrente**

`CONTA-CORRENTE-FASE-1-PREPARACAO.md` diz "preparada, não aplicada". As RPCs existem em produção — conferido em 11/08/2026:

```
cc_abrir_pendencia, cc_usar_pendencia, cc_encerrar_pendencia,
cc__assert_permissao, cc__assert_escopo_empresa, cc__status, cc__timeline,
cc__valor_pago, cc__id_empresa_proposta, cc__total_soberano_proposta,
mc_ajuste_avulso_criar, mc_ajuste_avulso_estornar,
mc_confirmar_abatimento_legado, mc_usar_credito_avulso
```

e `public.conta_corrente_pendencias` também existe. Atualizar o status do documento e a coluna "Status" das linhas correspondentes da Matriz (`FUTURO` → aplicado), sem alterar nada no banco.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m @'
docs(financeiro): registra a excecao de cancelamento de cobranca paga

Descreve a rota cancelar-pago como ponto oficial do caso, acrescenta a
operacao na Matriz de Seguranca e corrige o status da Conta Corrente Fase 1,
que estava documentada como nao aplicada mas esta em producao.
'@
```

---

### Task 6: Validação de ponta a ponta

**Files:** nenhum — é execução e relato.

- [ ] **Step 1: Subir o app**

Run: `npm run dev`

- [ ] **Step 2: Percorrer os cenários**

Marcar cada um com o resultado observado:

1. Super admin cancela cobrança paga do mês corrente, destino **Devolvido** → status `CANCELADO`, `motivo_cancela` gravado, card "Faturamento do período" cai pelo valor.
2. Mesma coisa com destino **Crédito** → conferir com SQL: `select tipo, valor, observacao from movimento_credito order by id desc limit 1;` e o saldo do cliente na tela de conta corrente.
3. Repetir a mesma requisição (duplo clique) → nenhum crédito em dobro; `select count(*) from movimento_credito where observacao like '%<id da cobranca>%';` deve devolver 1.
4. Usuário **não** super admin → alerta NEGADO; chamar a rota direto com o token dele deve devolver 403.
5. Proposta em `EM PRODUCAO` → bloqueio com a mensagem apontando a devolução para `REVISAO ATENDENTE`; nada gravado.
6. Devolver a proposta para `REVISAO ATENDENTE` pela tela de Pedidos e repetir → cancelamento permitido.
7. Cobrança confirmada em mês anterior → sem o checkbox, bloqueio `MES_FECHADO`; com o checkbox, sucesso.
8. Cobrança `A_RECEBER` → cancelamento pelo fluxo antigo continua funcionando exatamente como hoje.
9. Simular falha do crédito (informar destino `CREDITO` numa cobrança sem `id_cliente`) → cobrança **permanece paga**, nada gravado.
10. Regressão: `cancelar-externo` e `cancelar-boleto` continuam recusando cobrança paga.

- [ ] **Step 3: Relatar**

Informar comando executado e resultado de cada cenário. Não declarar sucesso em cenário que não foi executado.

---

## Self-review

**Cobertura da spec:**

| Seção da spec | Task |
|---|---|
| §4 arquitetura e contrato | 2 |
| §5 autorização super admin | 2 (rota), 4 (tela) |
| §6 bloqueios 1-6 | 1 (regras), 2 (aplicação) |
| §7 motivos e destino, RPC de crédito | 1 (catálogo), 2 (RPC) |
| §8 efeitos no sucesso | 2 |
| §9 interface | 3, 4 |
| §10 premissas | Resolvidas antes do plano: `devolverPropostaParaRevisaoAtendente` existe (`PedidosListPage`), e o menu já oferece a ação para cobrança paga |
| §11 validação (10 cenários) | 6 |
| §12 divergências de doc | 5 |
| §13 riscos | mitigações distribuídas entre 1, 2 e 6 |

**Placeholders:** nenhum "TBD"/"TODO". Os dois pontos deixados em aberto (retorno da RPC no Step 3 da Task 2, e a gravação do histórico no Step 4) têm comando de verificação e critério de decisão explícitos — não são lacunas.

**Consistência de tipos:** `MotivoCancelamentoPago` e `DestinoValorCancelado` são definidos na Task 1 e usados com os mesmos nomes nas Tasks 2, 3 e 4. Os códigos de erro da Task 2 são os mesmos consumidos na Task 4. A mudança de assinatura de `onConfirm` (Task 3) é resolvida na Task 4, e o plano avisa que o typecheck acusa entre as duas.
