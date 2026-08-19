/**
 * Testes do eixo cobrança: empresa recebedora sugerida e botões de link externo.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cobrancas-empresa-e-link.test.mts
 *
 * Sai com código 1 se algo falhar. Rode depois de mexer em
 * src/features/cobrancas/cobrancas-utils.ts — o modal de cobrança, o provider
 * que grava em pagamentos_v2 e o detalhe dependem dos dois helpers daqui.
 */
import {
  cobrancaTemLinkExterno,
  empresaRecebedoraPorTexto,
  resolverEmpresaRecebedora
} from "../../src/features/cobrancas/cobrancas-utils.ts";

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

/** Vocabulário REAL do banco, levantado em 18/08/2026 em propostas.empresa e clientes.empresa_padrao. */
const VALORES_REAIS: Array<[string, number]> = [
  ["IDEAL GRÁFICA EXPRESSA EIRELI", 1],
  ["Ideal Grafica", 1],
  ["IDEAL BIRÔ SERV. GRAFICOS", 2],
  ["Ideal Biro", 2],
  ["E3 BRINDES LTDA", 3],
  ["E3 Brindes", 3]
];

// ── O caso do enunciado ──────────────────────────────────────────────────────
// Proposta na Birô, cliente com padrão na Gráfica. A proposta manda.
checar("proposta Biro vence o padrao Grafica do cliente",
  resolverEmpresaRecebedora("Ideal Biro", "IDEAL GRÁFICA EXPRESSA EIRELI").id, 2);
checar("razao social da Biro tambem vence o padrao do cliente",
  resolverEmpresaRecebedora("IDEAL BIRÔ SERV. GRAFICOS", "IDEAL GRÁFICA EXPRESSA EIRELI").id, 2);
checar("o nome devolvido e o da lista fixa",
  resolverEmpresaRecebedora("Ideal Biro", null).nome, "IDEAL BIRÔ SERV. GRAFICOS");

// ── Precedência ──────────────────────────────────────────────────────────────
checar("sem empresa na proposta, vale o padrao do cliente",
  resolverEmpresaRecebedora(null, "IDEAL BIRÔ SERV. GRAFICOS").id, 2);
checar("proposta vazia (string em branco) tambem cai no padrao do cliente",
  resolverEmpresaRecebedora("   ", "E3 BRINDES LTDA").id, 3);
checar("'Nao informado' e placeholder, nao empresa: cai no default",
  resolverEmpresaRecebedora(null, "Não informado").id, 1);
checar("nada em lugar nenhum cai no default 1",
  resolverEmpresaRecebedora(null, null).id, 1);

// ── Reconhecimento por texto ─────────────────────────────────────────────────
for (const [texto, idEsperado] of VALORES_REAIS) {
  checar(`reconhece "${texto}"`, empresaRecebedoraPorTexto(texto)?.id, idEsperado);
}
checar("texto desconhecido nao e reconhecido", empresaRecebedoraPorTexto("ACME LTDA"), null);
checar("'Nao informado' nao e reconhecido", empresaRecebedoraPorTexto("Não informado"), null);

// ── PARIDADE com o algoritmo anterior ────────────────────────────────────────
// O anterior acertava os seis valores reais; o que ele errava era a PRECEDÊNCIA
// (padrão do cliente antes da proposta). Este bloco prova que a normalização
// nova não muda o id de nenhum caso que já acertava.
function algoritmoAntigo(texto: string): number {
  const n = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.includes("eireli") || n.includes("grafica expressa") || n.includes("grafica")) {
    if (n.includes("biro")) return 2;
    return 1;
  }
  if (n.includes("biro")) return 2;
  if (n.includes("e3") || n.includes("brindes")) return 3;
  return 1;
}
for (const [texto] of VALORES_REAIS) {
  checar(`paridade com o algoritmo antigo em "${texto}"`,
    empresaRecebedoraPorTexto(texto)?.id, algoritmoAntigo(texto));
}

// ── Botões de link externo ───────────────────────────────────────────────────
for (const tipo of ["PIX", "BOLETO", "CARD_PARCELADO", "CARD-PARCELADO", "CREDIT_CARD"]) {
  checar(`${tipo} TEM link externo`, cobrancaTemLinkExterno({ tipo_cobranca: tipo }), true);
}
for (const tipo of ["E-CREDITO", "e-credito", " E-Credito ", "E_CREDITO"]) {
  checar(`E-Credito (grafia "${tipo}") NAO tem link externo`,
    cobrancaTemLinkExterno({ tipo_cobranca: tipo }), false);
}
for (const tipo of ["E-FATURADO", "E-Faturado", "FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA", "E-AMOSTRAS"]) {
  checar(`${tipo} NAO tem link externo`, cobrancaTemLinkExterno({ tipo_cobranca: tipo }), false);
}
checar("tipo vazio nao bloqueia (comportamento anterior preservado)",
  cobrancaTemLinkExterno({ tipo_cobranca: "" }), true);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
