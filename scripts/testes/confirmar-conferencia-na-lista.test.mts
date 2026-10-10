/**
 * "Confirmar Conferência" no menu Ações da lista de Pedidos.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/confirmar-conferencia-na-lista.test.mts
 *
 * O QUE PROVA
 *   1. A MOVIMENTAÇÃO de `isFilaPadrao` (CobrancasList -> cobrancas-utils) não
 *      mudou a regra: a função de agora e uma cópia LITERAL da de antes dão o
 *      mesmo resultado para o mesmo conjunto de cobranças (grade de combinações).
 *   2. A Conferência passa a importar a função, e não a define mais.
 *   3. A lista usa o MESMO critério e a MESMA entrada da Conferência: o mesmo
 *      conjunto de cobranças dá a mesma Fila nas duas telas.
 *   4. A opção aparece se e somente se a cobrança está na Fila; sai quando a
 *      cobrança é confirmada; uma opção por cobrança quando há mais de uma.
 *   5. Só ADM vê a opção.
 */
import { readFileSync } from "node:fs";
import {
  isFilaPadrao,
  isPendenteAprovacao,
  normalizeCobrancaStatus
} from "../../src/features/cobrancas/cobrancas-utils.ts";
import {
  cobrancaDaListaEstaNaFila,
  cobrancasNaFilaPorPedido,
  podeVerConfirmarConferenciaNaLista,
  rotuloDaOpcaoDeConferencia
} from "../../src/features/orcamentos/lib/cobrancas-na-fila.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}
const ler = (caminho: string) => readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");

/** A função COMO ESTAVA em CobrancasList.tsx antes da mudança, literal. */
function isFilaPadraoAntes(cobranca: Parameters<typeof isPendenteAprovacao>[0]) {
  const status = (cobranca.status || "").trim().toUpperCase();

  if (status === "CANCELADO") return false;

  if (status === "PAID" && cobranca.confirmado === false) {
    return true;
  }

  if (status === "A_VENCER" && cobranca.confirmado === false) {
    return !isPendenteAprovacao(cobranca);
  }

  return false;
}

const STATUS = ["PAID", "A_VENCER", "A_RECEBER", "CANCELADO", "cancelado", " paid ", "", "VENCIDO", "REJEITADA"];
const CONFIRMADO = [true, false];
const TIPOS = ["PIX", "BOLETO", "CARD_PARCELADO", "E-FATURADO", "E_FATURADO", "EFATURADO", "FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA", "E-CREDITO", ""];
const POR = [undefined, "", "Maria"];

/* 1. Antes x depois */
{
  let total = 0, diferentes = 0, naFila = 0;
  for (const status of STATUS) for (const confirmado of CONFIRMADO) for (const tipo of TIPOS) for (const por of POR) {
    const c = { status, confirmado, tipo_cobranca: tipo, confirmado_por: por, valor: 100 } as never;
    total += 1;
    const antes = isFilaPadraoAntes(c);
    if (antes) naFila += 1;
    if (isFilaPadrao(c) !== antes) diferentes += 1;
  }
  checar("a regra movida da o mesmo resultado que a de antes, em toda a grade", [total, diferentes], [total, 0]);
  checar("a grade tem os dois resultados (nao e um teste vazio)", naFila > 0 && naFila < total, true);
}

/* 2. A Conferência importa, e não define */
{
  const lista = ler("src/features/cobrancas/CobrancasList.tsx");
  const utils = ler("src/features/cobrancas/cobrancas-utils.ts");
  checar("CobrancasList nao define mais isFilaPadrao", /function isFilaPadrao\s*\(/.test(lista), false);
  checar("CobrancasList importa isFilaPadrao de cobrancas-utils", /isFilaPadrao,[\s\S]*?from "@\/features\/cobrancas\/cobrancas-utils"/.test(lista), true);
  checar("a Fila continua filtrando por isFilaPadrao", lista.includes("filteredBase.filter(isFilaPadrao)"), true);
  checar("cobrancas-utils exporta isFilaPadrao, ao lado de isPendenteAprovacao", /export function isPendenteAprovacao[\s\S]*export function isFilaPadrao/.test(utils), true);
}

/* 3. Mesma Fila nas duas telas: o que a Conferência monta x o que a lista monta */
{
  /** O Cobranca como o mapper da Conferência o entrega (status normalizado, confirmado booleano). */
  const comoAConferencia = (linha: Record<string, unknown>) => {
    const confirmado = linha.confirmado === true;
    return {
      status: normalizeCobrancaStatus({ status: String(linha.status ?? ""), paidAt: String(linha.paid_at ?? ""), confirmado }),
      confirmado,
      tipo_cobranca: String(linha.tipo_cobranca ?? ""),
      confirmado_por: String(linha.confirmado_por ?? "") || undefined,
      valor: Number(linha.valor) || 0
    } as never;
  };
  let total = 0, diferentes = 0;
  const status = ["PAID", "A_VENCER", "A_RECEBER", "CANCELADO", "Cancelado", "pago", "Pago", "pendente", "aguardando", "vencido", "confirmado", "", null, "ESTORNADO"];
  for (const s of status) for (const confirmado of [true, false, null]) for (const tipo of TIPOS) for (const por of [null, "", "Maria"]) for (const paid_at of [null, "2026-10-09T12:00:00Z"]) {
    const linha = { id: "x", id_int: 1, status: s, confirmado, tipo_cobranca: tipo, confirmado_por: por, paid_at, valor: 10 };
    total += 1;
    if (cobrancaDaListaEstaNaFila(linha) !== isFilaPadrao(comoAConferencia(linha))) diferentes += 1;
  }
  checar("mesmo conjunto de cobrancas, mesma Fila na lista e na Conferencia", [total > 1000, diferentes], [true, 0]);
}

/* 4. A opção, por pedido */
const linha = (extra: Record<string, unknown>) => ({ id: "c1", id_int: 100, tipo_cobranca: "PIX", status: "PAID", confirmado: false, confirmado_por: null, paid_at: "2026-10-09T12:00:00Z", valor: 100, created_at: "2026-10-09T10:00:00Z", ...extra });

checar("PAID nao conferida: pedido na Fila", [...cobrancasNaFilaPorPedido([linha({})]).keys()], ["100"]);
checar("PAID ja conferida: fora da Fila", cobrancasNaFilaPorPedido([linha({ confirmado: true })]).size, 0);
checar("cancelada: fora", cobrancasNaFilaPorPedido([linha({ status: "CANCELADO" })]).size, 0);
checar("A_RECEBER: fora (ainda nao pagou)", cobrancasNaFilaPorPedido([linha({ status: "A_RECEBER" })]).size, 0);
checar("E-Faturado a vencer SEM autorizacao: fora (e pendente de aprovacao)", cobrancasNaFilaPorPedido([linha({ tipo_cobranca: "E-FATURADO", status: "A_VENCER", confirmado_por: null })]).size, 0);
checar("E-Faturado a vencer JA autorizado: na Fila", cobrancasNaFilaPorPedido([linha({ tipo_cobranca: "E-FATURADO", status: "A_VENCER", confirmado_por: "Financeiro" })]).get("100")?.length, 1);
checar("sem id da cobranca: nao ha como confirmar, fica de fora", cobrancasNaFilaPorPedido([linha({ id: null })]).size, 0);

// Depois de confirmar: a mesma cobranca, agora confirmada, some
checar("depois de confirmar a opcao some do pedido", [cobrancasNaFilaPorPedido([linha({})]).get("100")?.length, cobrancasNaFilaPorPedido([linha({ confirmado: true, confirmado_por: "Gerente" })]).get("100")], [1, undefined]);

// Um pedido com uma cobranca na Fila: rotulo simples
{
  const um = cobrancasNaFilaPorPedido([linha({})]).get("100")!;
  checar("uma cobranca na Fila: Confirmar Conferência", [um.length, rotuloDaOpcaoDeConferencia(um[0], um.length)], [1, "Confirmar Conferência"]);
}
// Duas ou mais: uma opcao por cobranca, com forma e valor, da mais antiga para a mais nova
{
  const duas = cobrancasNaFilaPorPedido([
    linha({ id: "c2", tipo_cobranca: "BOLETO", valor: 250.5, created_at: "2026-10-09T11:00:00Z" }),
    linha({ id: "c1", tipo_cobranca: "PIX", valor: 100, created_at: "2026-10-09T10:00:00Z" }),
    linha({ id: "c3", status: "CANCELADO", created_at: "2026-10-09T09:00:00Z" }),
    linha({ id: "c4", confirmado: true, created_at: "2026-10-09T08:00:00Z" })
  ]).get("100")!;
  checar("duas na Fila (as outras duas nao): uma opcao por cobranca, na ordem de criacao", duas.map((c) => c.id), ["c1", "c2"]);
  const rotulos = duas.map((c) => rotuloDaOpcaoDeConferencia(c, duas.length));
  checar("o rotulo traz a forma e o valor de cada uma", [rotulos[0].startsWith("Confirmar Conferência — PIX"), rotulos[0].includes("100,00"), rotulos[1].includes("Boleto"), rotulos[1].includes("250,50"), rotulos[0] !== rotulos[1]], [true, true, true, true, true]);
}
// Pedidos diferentes nao se misturam; pedido sem nada na Fila nao entra no mapa
{
  const mapa = cobrancasNaFilaPorPedido([linha({ id: "a", id_int: 1 }), linha({ id: "b", id_int: 2, confirmado: true }), linha({ id: "c", id_int: 3 })]);
  checar("cada pedido so ve as proprias cobrancas; o conferido nao aparece", [...mapa.entries()].map(([id, l]) => [id, l.map((c) => c.id)]), [["1", ["a"]], ["3", ["c"]]]);
}
checar("valor ilegivel nao quebra", cobrancasNaFilaPorPedido([linha({ valor: "abc" })]).get("100")?.[0].valor, 0);

/* 5. So ADM */
checar("super admin e admin veem; os demais nao", [
  podeVerConfirmarConferenciaNaLista({ isSuperAdmin: true }),
  podeVerConfirmarConferenciaNaLista({ isAdmin: true }),
  podeVerConfirmarConferenciaNaLista({ isAdmin: false, isSuperAdmin: false }),
  podeVerConfirmarConferenciaNaLista({}),
  podeVerConfirmarConferenciaNaLista(null),
  podeVerConfirmarConferenciaNaLista(undefined)
], [true, true, false, false, false, false]);

/* A lista nao escreve: o modal e a rota oficial sao os mesmos da Conferencia */
{
  const pagina = ler("src/features/orcamentos/OrcamentosListPageReal.tsx");
  checar("a lista abre o MESMO modal da Conferencia", pagina.includes("<ConfirmarLiberacaoModal"), true);
  checar("a lista nao chama a rota nem grava em pagamentos_v2 por conta propria", [/fetch\([^)]*cobrancas\/confirmar/.test(pagina), /from\("pagamentos_v2"\)\s*\.\s*(update|insert|upsert|delete)/.test(pagina)], [false, false]);
  checar("a opcao so entra no menu para ADM", /canConfirmarConferenciaNaLista\s*\?\s*item\.cobrancasNaFila\.map/.test(pagina), true);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
