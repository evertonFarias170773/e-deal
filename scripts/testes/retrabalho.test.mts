/**
 * Retrabalho (17/10/2026): a regra (`src/lib/retrabalho.ts`) e o mapeamento da lista de Pedidos.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/retrabalho.test.mts
 */
import { readFileSync } from "node:fs";
import {
  COR_RETRABALHO,
  COR_RETRABALHO_CLARO,
  COR_RETRABALHO_ESCURO,
  ROTULO_RETRABALHO,
  cobrancaEhRetrabalho,
  pedidoEhRetrabalho,
  retrabalhoPelosTiposVivos
} from "../../src/lib/retrabalho.ts";
import { mapSupabasePropostaRowsToListItems } from "../../src/features/orcamentos/mappers.ts";
import type { SupabasePropostaRow } from "../../src/features/orcamentos/types.supabase.ts";
import { ativosValem, passaAtivos, FILTRO_COBRANCA_RETRABALHO } from "../../src/features/orcamentos/lib/status-ativos.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// ── 1. A regra ──
const c = (tipo_cobranca: string | null, status: string | null = "PAID") => ({ tipo_cobranca, status });
checar("E-RETRABALHO viva e retrabalho (PAID, A_VENCER, A_RECEBER, sem status)", ["PAID", "A_VENCER", "A_RECEBER", null].map((s) => cobrancaEhRetrabalho(c("E-RETRABALHO", s))), [true, true, true, true]);
checar("E-RETRABALHO cancelada, extornada ou recusada nao conta", ["CANCELADO", "EXTORNADO", "RECUSADO", " cancelado "].map((s) => cobrancaEhRetrabalho(c("E-RETRABALHO", s))), [false, false, false, false]);
checar("E-AMOSTRA, E-PERMUTA, E-FATURADO e outras nao sao retrabalho", ["E-AMOSTRA", "E-PERMUTA", "E-FATURADO", "PIX", "BOLETO", null, ""].map((t) => cobrancaEhRetrabalho(c(t))), [false, false, false, false, false, false, false]);
checar("caixa e espaco nao enganam", [cobrancaEhRetrabalho(c(" e-retrabalho ")), cobrancaEhRetrabalho(c("E-Retrabalho", "paid"))], [true, true]);
checar("pedido: basta UMA viva; so canceladas, nao", [
  pedidoEhRetrabalho([c("PIX"), c("E-RETRABALHO")]),
  pedidoEhRetrabalho([c("E-RETRABALHO", "CANCELADO"), c("PIX")]),
  pedidoEhRetrabalho([]),
  pedidoEhRetrabalho(null),
  pedidoEhRetrabalho([c("E-AMOSTRA"), c("E-PERMUTA")])
], [true, false, false, false, false]);
checar("pelos tipos vivos", [retrabalhoPelosTiposVivos(["E-RETRABALHO"]), retrabalhoPelosTiposVivos(["PIX", "e-retrabalho"]), retrabalhoPelosTiposVivos(["E-AMOSTRA", "E-PERMUTA"]), retrabalhoPelosTiposVivos([]), retrabalhoPelosTiposVivos(undefined)], [true, true, false, false, false]);
checar("selo e cor", [ROTULO_RETRABALHO, COR_RETRABALHO], ["Retrabalho", "var(--retrabalho)"]);

// ── 2. O token e a constante do PDF tem os mesmos valores ──
const css = readFileSync("src/app/globals.css", "utf8");
const valores = [...css.matchAll(/--retrabalho:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
checar("token --retrabalho existe nos dois temas (claro e escuro)", valores.length, 2);
checar("token claro e escuro = constantes do PDF", valores, [COR_RETRABALHO_CLARO, COR_RETRABALHO_ESCURO]);
const iEscuro = css.indexOf("\n.dark {");
checar("o segundo valor fica no bloco .dark", css.lastIndexOf("--retrabalho:") > iEscuro && css.indexOf("--retrabalho:") < iEscuro, true);

// ── 3. O mapeamento da lista ──
const linha = (id: number, extra: Partial<SupabasePropostaRow>): SupabasePropostaRow => ({ id: id, id_int: id, cliente: "Cliente", status_interno: "ENTREGUE", valor_total: 100, ...extra }) as SupabasePropostaRow;
const [a, b, d, e, f] = mapSupabasePropostaRowsToListItems([
  linha(1, { tipos_cobranca: ["E-RETRABALHO"] }),
  linha(2, { tipos_cobranca: ["PIX"] }),
  linha(3, { tipos_cobranca: [] }),
  linha(4, { tipos_cobranca: ["E-AMOSTRA", "E-PERMUTA"] }),
  // `tipo_cobranca` solto NAO diz se a cobranca morreu: so `tipos_cobranca` (vivas) decide.
  linha(5, { tipos_cobranca: [], tipo_cobranca: "E-RETRABALHO" } as Partial<SupabasePropostaRow>)
]);
checar("mapeamento: isRetrabalho so com E-RETRABALHO em tipos_cobranca (vivas)", [a.isRetrabalho, b.isRetrabalho, d.isRetrabalho, e.isRetrabalho, f.isRetrabalho], [true, false, false, false, false]);
checar("mapeamento: os outros campos nao mudam (tiposCobranca segue igual)", [a.tiposCobranca, b.tiposCobranca, f.tiposCobranca], [["E-RETRABALHO"], ["PIX"], ["E-RETRABALHO"]]);

// ── 4. Estrutura da tela ──
const tela = readFileSync("src/features/orcamentos/OrcamentosListPageReal.tsx", "utf8");
const lista = readFileSync("src/components/common/ResponsiveList.tsx", "utf8");
checar("tabela: contorno pelo token, numero e selo", [tela.includes("getRowOutline={(proposta) => (proposta.isRetrabalho ? COR_RETRABALHO : null)}"), tela.includes("<NumeroDoPedido idInt={proposta.id_int} retrabalho={proposta.isRetrabalho} />")], [true, true]);
checar("cartao: contorno, numero e selo", [tela.includes("style={proposta.isRetrabalho ? { outline: `2px solid ${COR_RETRABALHO}`"), tela.includes("<SeloRetrabalho />")], [true, true]);
checar("sem cor literal no destaque do retrabalho na tela", /retrabalho[^\n]{0,80}#[0-9a-fA-F]{3,6}/i.test(tela), false);
checar("ResponsiveList: contorno so para quem passa getRowOutline", lista.includes("...(getRowOutline?.(item) ? { outline:"), true);

// ── 5. Filtro Cobranca = E-RETRABALHO (19/10/2026) ──
checar("ativosValem: sem o filtro, como antes (Ativos sem busca vale; com busca ou outro status, nao)", [
  ativosValem({ status: "ATIVOS", temBusca: false }),
  ativosValem({ status: "ATIVOS", temBusca: true }),
  ativosValem({ status: "TODOS", temBusca: false }),
  ativosValem({ status: "ATIVOS", temBusca: false, filtroCobranca: "PIX" }),
  ativosValem({ status: "ATIVOS", temBusca: false, filtroCobranca: "E-FATURADO" }),
  ativosValem({ status: "ATIVOS", temBusca: false, filtroCobranca: "TODOS" })
], [true, false, false, true, true, true]);
checar("ativosValem: com E-RETRABALHO o Ativos nao vale", [ativosValem({ status: "ATIVOS", temBusca: false, filtroCobranca: FILTRO_COBRANCA_RETRABALHO }), ativosValem({ status: "ATIVOS", temBusca: false, filtroCobranca: " e-retrabalho " })], [false, false]);
const ped = (statusInterno: string, isAvulsoRaw = false) => ({ statusInterno, isAvulsoRaw });
checar("passaAtivos: ENTREGUE, EM TRANSITO e CANCELADO saem do Ativos sem o filtro", ["ENTREGUE", "EM TRANSITO", "CANCELADO"].map((st) => passaAtivos(ped(st), { status: "ATIVOS", modelo: "TODOS_MODELOS", temBusca: false })), [false, false, false]);
checar("passaAtivos: com E-RETRABALHO eles ficam", ["ENTREGUE", "EM TRANSITO", "CANCELADO", "EM PRODUCAO"].map((st) => passaAtivos(ped(st), { status: "ATIVOS", modelo: "TODOS_MODELOS", temBusca: false, filtroCobranca: "E-RETRABALHO" })), [true, true, true, true]);
checar("passaAtivos: com PIX segue como antes (ENTREGUE sai)", passaAtivos(ped("ENTREGUE"), { status: "ATIVOS", modelo: "TODOS_MODELOS", temBusca: false, filtroCobranca: "PIX" }), false);
{
  // A selecao do servidor: as linhas de pagamentos_v2 com tipo E-RETRABALHO passam pela mesma regra.
  const linhas = [
    { id_int: 1, tipo_cobranca: "E-RETRABALHO", status: "PAID" },
    { id_int: 2, tipo_cobranca: "E-RETRABALHO", status: "CANCELADO" },
    { id_int: 3, tipo_cobranca: "e-retrabalho", status: null },
    { id_int: 4, tipo_cobranca: "E-RETRABALHO", status: "EXTORNADO" },
    { id_int: 5, tipo_cobranca: "E-RETRABALHO", status: "recusado" }
  ];
  checar("filtro do servidor: viva entra, cancelada/extornada/recusada fora", linhas.filter(cobrancaEhRetrabalho).map((l) => l.id_int), [1, 3]);
}
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
checar("servidor: E-RETRABALHO tem ramo proprio, sem ilike com coringa, e o Ativos recebe o filtro", [
  servico.includes('if (filters?.filterTipoCobranca === FORMA_RETRABALHO) {'),
  servico.includes('.ilike("tipo_cobranca", FORMA_RETRABALHO)'),
  servico.includes(".filter(cobrancaEhRetrabalho)"),
  servico.includes("filtroCobranca: filters?.filterTipoCobranca")
], [true, true, true, true]);
checar("servidor: a lista padrao (neq CANCELADO / neq ENTREGUE) nao corta com E-RETRABALHO, e segue cortando nas outras opcoes", [
  servico.includes('} else if (visibilidadeEncerrados !== "SOMENTE" && filters?.filterTipoCobranca !== FORMA_RETRABALHO) {'),
  servico.includes('if (!condicaoBusca) query = query.neq("status_interno", "ENTREGUE");')
], [true, true]);
checar("tela: o corte de CANCELADO do cliente tambem respeita o filtro", tela.includes('(filterTipoCobranca === "E-RETRABALHO" || item.status !== "CANCELADO")'), true);
checar("servidor: as outras opcoes seguem com o mesmo ilike de antes", servico.includes('.ilike("tipo_cobranca", `%${searchTipo}%`)'), true);
checar("tela: opcao no enum e no dropdown, e os dois filtros do cliente usam isRetrabalho", [
  tela.includes('"E-FATURADO", "E-RETRABALHO", "CARTAO"'),
  tela.includes('<option value="E-RETRABALHO">E-RETRABALHO</option>'),
  (tela.match(/if \(filterTipoCobranca === "E-RETRABALHO"\)/g) ?? []).length,
  (tela.match(/filtroCobranca: filterTipoCobranca/g) ?? []).length
], [true, true, 2, 2]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
