/**
 * Tipos de cobrança — fonte única e filtro "Cobrança" da lista de Propostas (12/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/tipos-cobranca.test.mts
 */
import { readFileSync } from "node:fs";
import {
  grafiasDoFiltroCobranca,
  opcoesDoFiltroCobranca,
  tipoEntraNoFiltroCobranca,
  TIPOS_COBRANCA,
  VALORES_FILTRO_COBRANCA
} from "../../src/features/cobrancas/tipos-cobranca.ts";
import { mapSupabasePropostaRowsToListItems } from "../../src/features/orcamentos/mappers.ts";
import type { SupabasePropostaRow } from "../../src/features/orcamentos/types.supabase.ts";

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

// ── A constante ──
checar(
  "os 9 tipos de antes do CobrancaTipo continuam",
  TIPOS_COBRANCA.map((t) => t.tipo).sort(),
  ["BOLETO", "CARD_PARCELADO", "CREDIT_CARD", "E-AMOSTRA", "E-CREDITO", "E-FATURADO", "E-PERMUTA", "E-RETRABALHO", "PIX"]
);
checar(
  "todas as grafias gravadas em 12/11 estao na constante",
  ["PIX", "CARD_PARCELADO", "E-FATURADO", "BOLETO", "E-CREDITO", "CREDIT_CARD", "E-Faturado", "E-RETRABALHO", "E-AMOSTRA", "E-PERMUTA"].every((g) =>
    TIPOS_COBRANCA.some((t) => (t.grafias as readonly string[]).includes(g))
  ),
  true
);

// ── As opções do filtro ──
const opcoes = opcoesDoFiltroCobranca();
checar(
  "opcoes na ordem pedida, com os nomes de exibicao",
  opcoes.map((o) => o.rotulo),
  ["PIX", "Boleto", "Cartão de crédito", "E-Faturado", "E-Crédito", "E-Retrabalho", "E-Amostra", "E-Permuta"]
);
checar("valores da URL: TODOS primeiro e os de antes continuam", VALORES_FILTRO_COBRANCA, ["TODOS", "PIX", "BOLETO", "CARTAO", "E-FATURADO", "E-CREDITO", "E-RETRABALHO", "E-AMOSTRA", "E-PERMUTA"]);
checar("Cartao de credito junta o de hoje e o antigo", grafiasDoFiltroCobranca("CARTAO"), ["CARD_PARCELADO", "CREDIT_CARD"]);
checar("E-Faturado pega as duas grafias", grafiasDoFiltroCobranca("E-FATURADO"), ["E-FATURADO", "E-Faturado"]);
checar("E-Credito consulta o gravado", grafiasDoFiltroCobranca("E-CREDITO"), ["E-CREDITO"]);
checar("opcao desconhecida nao consulta nada", grafiasDoFiltroCobranca("XYZ"), []);

// ── A comparação na lista (tipos como o mapper entrega) ──
const casos: Array<[string, string, boolean]> = [
  ["PIX", "PIX", true],
  ["BOLETO", "BOLETO", true],
  ["CARD_PARCELADO", "CARTAO", true],
  ["CREDIT_CARD", "CARTAO", true],
  ["CARTAO", "CARTAO", true],
  ["E-FATURADO", "E-FATURADO", true],
  ["E-Faturado", "E-FATURADO", true],
  ["E-CREDITO", "E-CREDITO", true],
  ["E-AMOSTRAS", "E-AMOSTRA", true],
  ["E-AMOSTRA", "E-AMOSTRA", true],
  ["E-PERMUTA", "E-PERMUTA", true],
  ["E-RETRABALHO", "E-RETRABALHO", true],
  ["E-CREDITO", "PIX", false],
  ["PIX", "CARTAO", false],
  ["E-FATURADO", "E-CREDITO", false],
  ["E-PERMUTA", "E-FATURADO", false],
  ["", "PIX", false]
];
for (const [tipo, filtro, esperado] of casos) checar(`${tipo || "(vazio)"} em ${filtro}`, tipoEntraNoFiltroCobranca(tipo, filtro), esperado);

// ── Antes x depois, pelo mapper real da lista ──
// Cada grafia gravada em 12/11 passa pelo mapper (como a lista recebe) e e
// comparada com o criterio ANTIGO da tela nas 4 opcoes que ja existiam.
const criterioAntigo = (t: string, filtro: string) => {
  const upper = t.trim().toUpperCase();
  return filtro === "CARTAO" ? upper.includes("CARD") || upper.includes("CARTAO") || upper.includes("CARTÃO") : upper === filtro;
};
const gravadas = ["PIX", "CARD_PARCELADO", "E-FATURADO", "BOLETO", "E-CREDITO", "CREDIT_CARD", "E-Faturado", "E-RETRABALHO", "E-AMOSTRA", "E-PERMUTA"];
const itens = mapSupabasePropostaRowsToListItems(
  gravadas.map((g, i) => ({ id: String(i + 1), id_int: i + 1, cliente: "C", status_interno: "NOVO", valor_total: 1, tipos_cobranca: [g] }) as SupabasePropostaRow)
);
const divergencias: string[] = [];
for (const filtro of ["PIX", "BOLETO", "CARTAO", "E-FATURADO"]) {
  itens.forEach((item, i) => {
    const antes = item.tiposCobranca.some((t) => criterioAntigo(t, filtro));
    const depois = item.tiposCobranca.some((t) => tipoEntraNoFiltroCobranca(t, filtro));
    if (antes !== depois) divergencias.push(`${gravadas[i]} em ${filtro}: antes ${antes}, depois ${depois}`);
  });
}
checar("PIX, Boleto, Cartao e E-Faturado: mesmo resultado de antes para toda grafia gravada", divergencias, []);
const opcoesNovas = Object.fromEntries(
  ["E-CREDITO", "E-AMOSTRA", "E-PERMUTA"].map((f) => [f, gravadas.filter((g, i) => itens[i].tiposCobranca.some((t) => tipoEntraNoFiltroCobranca(t, f)))])
);
checar("opcoes novas pegam so a sua grafia (E-AMOSTRA chega como E-AMOSTRAS)", opcoesNovas, { "E-CREDITO": ["E-CREDITO"], "E-AMOSTRA": ["E-AMOSTRA"], "E-PERMUTA": ["E-PERMUTA"] });

// ── A tela e o servidor usam a constante ──
const pagina = readFileSync("src/features/orcamentos/OrcamentosListPageReal.tsx", "utf8");
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
checar("dropdown: Todas cobrancas primeiro, depois as opcoes da constante", pagina.includes('<option value="TODOS">Todas cobranças</option>\n              {OPCOES_FILTRO_COBRANCA.map(') || pagina.includes('<option value="TODOS">Todas cobranças</option>\r\n              {OPCOES_FILTRO_COBRANCA.map('), true);
checar("sem opcao fixa no dropdown", /<option value="(PIX|BOLETO|CARTAO|E-FATURADO|E-RETRABALHO)">/.test(pagina), false);
checar("as duas comparacoes da lista usam a constante", pagina.split("tipoEntraNoFiltroCobranca(t, filterTipoCobranca)").length - 1, 2);
checar("servidor consulta as grafias da constante", servico.includes("grafiasDoFiltroCobranca(filters.filterTipoCobranca)") && !servico.includes('ilike("tipo_cobranca", `%${searchTipo}%`)'), true);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
