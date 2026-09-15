/**
 * Parcela com que o rascunho de NF-e nasce.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/parcela-inicial-nfe.test.mts [id_int ...]
 *
 * Parte 1 prova a regra com a função REAL (`condicaoDaParcelaInicial`). Parte 2
 * simula, SEM GRAVAR, o que `createOrReuseNfeDraft` faria no passo das parcelas
 * para cada pedido: lê a cobrança e a condição pelos mesmos serviços, aplica a
 * regra e projeta as parcelas pela conta de `fn_gerar_pagamentos_nfe` (vencimento
 * = hoje + dias + intervalo x (n-1); valor truncado no centavo, sobra na última).
 * Todo `fetch` que não seja leitura é barrado.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const escritas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    escritas.push(`${metodo} ${url.split("?")[0]}`);
    throw new Error(`escrita barrada no teste: ${metodo} ${url.split("?")[0]}`);
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const { condicaoDaParcelaInicial, somarDiasIso, PRAZO_MINIMO_FATURADO_DIAS } = await import("../../src/features/nfe/lib/parcela-inicial-nfe.ts");
type Modelo = Parameters<typeof condicaoDaParcelaInicial>[1];
const modelo = (resultado: string, qtd: number, inicio: number, intervalo: number) =>
  ({ id: resultado, resultado, qtd_parcela: qtd, inicio, intervalo, modelo: "Prazo", entrada_porcento: 0 } as unknown as NonNullable<Modelo>);

// ── 1. A regra ──────────────────────────────────────────────────────────────
checar("prazo minimo e 7 dias", PRAZO_MINIMO_FATURADO_DIAS, 7);
checar("E-FATURADO com condicao 7/14/21: 3x, 7 dias, intervalo 7",
  condicaoDaParcelaInicial("E-FATURADO", modelo("Prazo 7/14/21 dias", 3, 7, 7)),
  { qtdParcelas: 3, diasPraInicio: 7, intervalo: 7, origem: "CONDICAO_DA_COBRANCA", condicao: "Prazo 7/14/21 dias" });
checar("E-Faturado (grafia antiga) sem condicao: prazo minimo",
  condicaoDaParcelaInicial("E-Faturado", null),
  { qtdParcelas: 1, diasPraInicio: 7, intervalo: 0, origem: "PRAZO_MINIMO", condicao: null });
checar("E-AMOSTRA com condicao 28/42: segue a condicao",
  condicaoDaParcelaInicial("E-AMOSTRA", modelo("Prazo 28/42 dias", 2, 28, 14))?.origem, "CONDICAO_DA_COBRANCA");
checar("condicao que comecaria no dia (inicio 0): prazo minimo",
  condicaoDaParcelaInicial("E-FATURADO", modelo("A vista", 1, 0, 0))?.origem, "PRAZO_MINIMO");
for (const tipo of ["PIX", "BOLETO", "CREDIT_CARD", "CARD_PARCELADO", "E-CREDITO", null, ""]) {
  checar(`${JSON.stringify(tipo)}: nasce como antes (null)`, condicaoDaParcelaInicial(tipo, modelo("Prazo 7 dias", 1, 7, 0)), null);
}
checar("somarDiasIso: 15/09 + 7 = 22/09", somarDiasIso("2026-09-15", 7), "2026-09-22");
checar("somarDiasIso: vira o mes", somarDiasIso("2026-09-28", 7), "2026-10-05");

// ── 2. Simulacao do passo das parcelas, sem gravar ──────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE || ids.length === 0) {
  console.log("\n(pulando a simulacao: sem chaves no .env.local ou sem id_int)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { getTipoCobrancaDoPedido, codigoFiscalDaCobranca } = await import("../../src/features/nfe/services/nfe.service.ts");
  const { getPropostaDetailById } = await import("../../src/features/orcamentos/services/orcamentos.service.ts");
  const { buscarModeloCobrancaDaProposta, listarModelosCobranca } = await import("../../src/features/cobrancas/services/modelos-cobranca.ts");
  const { isFamiliaFaturado } = await import("../../src/features/cobrancas/cobrancas-utils.ts");

  const agora = new Date();
  const hojeLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
  const hojeUtc = agora.toISOString().split("T")[0];
  const catalogo = await listarModelosCobranca();

  for (const idInt of ids) {
    const proposta = await getPropostaDetailById(idInt);
    const tipo = await getTipoCobrancaDoPedido(idInt);
    const idModelo = isFamiliaFaturado(tipo) ? await buscarModeloCobrancaDaProposta(idInt) : null;
    const modeloDaCobranca = idModelo ? catalogo.find((m) => String(m.id) === idModelo) ?? null : null;
    const condicao = condicaoDaParcelaInicial(tipo, modeloDaCobranca);
    const forma = codigoFiscalDaCobranca(tipo);
    const total = Math.round(Number(proposta?.resumo?.valorTotal ?? 0) * 100) / 100;

    console.log(`\n#${idInt} | cobranca ${tipo ?? "(nenhuma)"} | faturado ${isFamiliaFaturado(tipo)} | condicao gravada ${modeloDaCobranca?.resultado ?? "(nenhuma)"} | forma ${forma} | total ${total.toFixed(2)}`);
    console.log(`  ANTES: 1x ${total.toFixed(2)} vencendo ${hojeUtc}${forma === "15" ? " (forma 15 = duplicata no dia)" : ""}`);
    if (!condicao) {
      console.log(`  AGORA: 1x ${total.toFixed(2)} vencendo ${hojeUtc} — igual a antes`);
      continue;
    }
    const cent = Math.round(total * 100);
    const parcela = Math.trunc(cent / condicao.qtdParcelas);
    const linhas = Array.from({ length: condicao.qtdParcelas }, (_, i) => ({
      n: i + 1,
      vencimento: somarDiasIso(hojeLocal, condicao.diasPraInicio + condicao.intervalo * i),
      valor: (i < condicao.qtdParcelas - 1 ? parcela : cent - parcela * (condicao.qtdParcelas - 1)) / 100
    }));
    console.log(`  AGORA: ${condicao.origem}${condicao.condicao ? ` (${condicao.condicao})` : ""} -> ${linhas.map((l) => `${l.n}) ${l.vencimento} R$ ${l.valor.toFixed(2)}`).join(" | ")}`);
    checar(`#${idInt}: nenhuma parcela vence no dia`, linhas.every((l) => l.vencimento > hojeLocal), true);
    checar(`#${idInt}: parcelas somam o total`, Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 100), cent);
  }
}

checar("nenhuma escrita tentada", escritas, []);
console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
