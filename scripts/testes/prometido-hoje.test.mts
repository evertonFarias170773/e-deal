/**
 * O congelamento do "prometido hoje" quando o pedido JÁ SAIU EM OUTRO DIA.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/prometido-hoje.test.mts
 *
 * Existe porque são DUAS regras de congelamento diferentes, de propósito, e a
 * diferença é sutil: o ATRASO para por ETAPA (fora da bancada, para), o
 * PROMETIDO HOJE para por DIA (fora da bancada, para se a saída foi antes de
 * hoje). Copiar uma na outra apagaria o que a decisão de 25/08 quis manter.
 *
 * A regra vive em `expedicao.service.ts`, dentro do pipeline da lista, e por
 * isso a parte pura é reproduzida aqui com as MESMAS condições — a conferência
 * de ponta a ponta vem da parte do banco, no fim.
 *
 * SÓ LEITURA; roda sem `PERMITIR_ESCRITA`.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

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

const HOJE = "2026-09-09";
const diaSaoPaulo = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/** A MESMA condição do service, palavra por palavra. */
function prometidoHoje(entrada: {
  etapa: string;
  promessaDia: string | null;
  coletadoEm?: string | null;
  dataDespacho?: string | null;
}): boolean {
  const { etapa, promessaDia } = entrada;
  const emAberto = etapa !== "ENTREGUE";
  const foraDaBancada = etapa === "A_RETIRAR" || etapa === "EM_TRANSITO" || etapa === "ENTREGUE";
  const saida = etapa === "EM_TRANSITO" ? (entrada.coletadoEm ?? entrada.dataDespacho) : entrada.dataDespacho;
  const saiuEmOutroDia = foraDaBancada && Boolean(saida) && diaSaoPaulo(saida!) !== HOJE;
  return emAberto && promessaDia === HOJE && !saiuEmOutroDia;
}

// 08/09 16:32 UTC = 13:32 em Sao Paulo, ontem. E o carimbo real do 21722.
const ONTEM = "2026-09-08T16:32:39Z";
const HOJE_CEDO = "2026-09-09T11:00:00Z"; // 08:00 daqui
// 09/09 02:00 UTC = 08/09 23:00 daqui: a virada de dia tem de sair no fuso certo.
const ONTEM_TARDE_UTC_DE_HOJE = "2026-09-09T02:00:00Z";

// ── 1. SAIU HOJE CONTA — e a decisao de 25/08 preservada ────────────────────
checar("EM_TRANSITO que saiu hoje pelo despacho conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, dataDespacho: HOJE_CEDO }), true);
checar("EM_TRANSITO que saiu hoje pela coleta conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, coletadoEm: HOJE_CEDO, dataDespacho: ONTEM }), true);
checar("A_RETIRAR que foi ao balcao hoje conta",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: HOJE_CEDO }), true);

// ── 2. SAIU EM OUTRO DIA NAO CONTA — o caso do 21722 ────────────────────────
checar("EM_TRANSITO despachado ontem NAO conta — o 21722",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, dataDespacho: ONTEM }), false);
checar("A_RETIRAR posto no balcao ontem NAO conta",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: ONTEM }), false);
// A COLETA MANDA em EM_TRANSITO: despachado ontem, coletado hoje, ainda conta —
// e o inverso tambem vale.
checar("coleta de HOJE vence despacho de ONTEM",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, coletadoEm: HOJE_CEDO, dataDespacho: ONTEM }), true);
checar("coleta de ONTEM nao e salva por despacho de hoje",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, coletadoEm: ONTEM, dataDespacho: HOJE_CEDO }), false);

// ── 3. O CORTE E POR DIA NO FUSO DAQUI, nao em UTC ──────────────────────────
// 09/09 02:00 UTC ainda e 08/09 as 23:00 em Sao Paulo: saiu ONTEM.
checar("virada de dia: 09/09 02:00 UTC e ontem daqui, entao NAO conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, dataDespacho: ONTEM_TARDE_UTC_DE_HOJE }), false);

// ── 4. SEM CARIMBO CONTINUA CONTANDO ────────────────────────────────────────
// Sem data nao da para afirmar que saiu em outro dia, e sumir do card e pior que
// sobrar nele.
checar("EM_TRANSITO sem carimbo nenhum continua contando",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE }), true);
checar("A_RETIRAR sem carimbo continua contando",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE }), true);

// ── 5. A BANCADA NAO MUDA ───────────────────────────────────────────────────
// Nem chega ao teste da saida: o carimbo velho de uma passagem anterior — o caso
// do 21594 — nao e sequer lido.
for (const etapa of ["PRODUCAO", "ACABAMENTO", "PRONTO"]) {
  checar(`${etapa} com promessa de hoje conta`,
    prometidoHoje({ etapa, promessaDia: HOJE }), true);
  checar(`${etapa} com carimbo velho de despacho AINDA conta`,
    prometidoHoje({ etapa, promessaDia: HOJE, dataDespacho: "2026-09-03T18:50:00Z" }), true);
}

// ── 6. O resto da condicao segue valendo ────────────────────────────────────
checar("promessa de outro dia nao conta, mesmo saindo hoje",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: "2026-09-10", dataDespacho: HOJE_CEDO }), false);
checar("sem promessa nao conta",
  prometidoHoje({ etapa: "PRONTO", promessaDia: null }), false);
checar("ENTREGUE nunca conta, saindo hoje ou nao",
  prometidoHoje({ etapa: "ENTREGUE", promessaDia: HOJE, dataDespacho: HOJE_CEDO }), false);

// ── 7. Contra a base real ───────────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { listarPainelExpedicao } = await import("../../src/features/expedicao/services/expedicao.service.ts");
  const pedidos = await listarPainelExpedicao();

  const ehAtrasado = (p: (typeof pedidos)[number]) => p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
  const ehDoDia = (p: (typeof pedidos)[number]) => ehAtrasado(p) || p.prometidoHoje;
  const doDia = pedidos.filter(ehDoDia);

  console.log(`\ncard "Expedicao do dia" no painel real: ${doDia.length}`);
  for (const p of [...doDia].sort((a, b) => a.idInt - b.idInt)) {
    console.log(`   #${p.idInt} ${p.etapa.padEnd(12)} ${ehAtrasado(p) ? "ATRASADO" : "PROMETIDO HOJE"}`);
  }

  // NENHUM pedido fora da bancada com saida de outro dia pode estar no card por
  // "prometido hoje" — e a garantia da regra sobre o painel inteiro.
  const vazados = doDia.filter((p) => {
    if (!p.prometidoHoje) return false;
    const fora = p.etapa === "A_RETIRAR" || p.etapa === "EM_TRANSITO";
    const saida = p.etapa === "EM_TRANSITO"
      ? (p.expedicao?.coletadoEm ?? p.expedicao?.dataDespacho)
      : p.expedicao?.dataDespacho;
    return fora && Boolean(saida) && diaSaoPaulo(saida!) !== diaSaoPaulo(new Date().toISOString());
  });
  checar("nenhum pedido que saiu em outro dia conta como prometido hoje", vazados.length, 0);

  // O clique aplica o MESMO predicado da contagem.
  checar("contagem e clique mostram o mesmo conjunto",
    pedidos.filter(ehDoDia).length, doDia.length);

  const p21594 = pedidos.find((p) => p.idInt === 21594);
  if (p21594) {
    checar("#21594 continua no card", ehDoDia(p21594), true);
    checar("#21594 entra por ATRASO, nao por prometido hoje", ehAtrasado(p21594), true);
    checar("#21594 nao e prometido hoje", p21594.prometidoHoje, false);
  } else {
    console.log("   (#21594 fora do painel nesta carga)");
  }
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
