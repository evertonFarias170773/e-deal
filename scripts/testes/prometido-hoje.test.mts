/**
 * O congelamento do "prometido hoje" quando o pedido JÁ SAIU.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/prometido-hoje.test.mts
 *
 * Existe porque são TRÊS regras de congelamento diferentes, de propósito, e as
 * diferenças são sutis:
 *
 *   ATRASO        para por ETAPA — fora da bancada, para.
 *   EM TRÂNSITO   para por CARIMBO — qualquer saída registrada tira do dia,
 *                 inclusive a de hoje (09/09/2026, 2ª decisão).
 *   A RETIRAR     para por DIA — em retirada nada saiu, o volume está no
 *                 balcão; só some quando o dia vira.
 *
 * Copiar uma na outra quebra alguma coisa: igualar A RETIRAR ao trânsito some
 * com o que está no balcão esperando o cliente, e igualar o trânsito ao atraso
 * ressuscita o volume que já foi embora.
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
  const jaSaiu = etapa === "EM_TRANSITO" ? Boolean(saida) : saiuEmOutroDia;
  return emAberto && promessaDia === HOJE && !jaSaiu;
}

// 08/09 16:32 UTC = 13:32 em Sao Paulo, ontem. E o carimbo real do 21722.
const ONTEM = "2026-09-08T16:32:39Z";
const HOJE_CEDO = "2026-09-09T11:00:00Z"; // 08:00 daqui
// 09/09 02:00 UTC = 08/09 23:00 daqui: a virada de dia tem de sair no fuso certo.
const ONTEM_TARDE_UTC_DE_HOJE = "2026-09-09T02:00:00Z";

// ── 1. EM TRANSITO COM CARIMBO NAO CONTA, nem no dia em que saiu ────────────
// A 2a decisao de 09/09/2026. O volume ja esta com a transportadora e nao pede
// acao de expedicao nenhuma hoje: 21862, 21789 e 21459 ocupavam 3 das 7 linhas
// do card so por terem sido despachados de manha.
checar("EM_TRANSITO despachado HOJE nao conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, dataDespacho: HOJE_CEDO }), false);
checar("EM_TRANSITO coletado HOJE nao conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, coletadoEm: HOJE_CEDO, dataDespacho: ONTEM }), false);

// O BALCAO NAO SEGUE ESSA REGRA: em retirada nada saiu. O volume esta no balcao
// esperando o cliente, e continua sendo responsabilidade da casa hoje.
checar("A_RETIRAR que foi ao balcao hoje CONTINUA contando",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: HOJE_CEDO }), true);

// ── 2. SAIU EM OUTRO DIA NAO CONTA — o caso do 21722 ────────────────────────
checar("EM_TRANSITO despachado ontem NAO conta — o 21722",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, dataDespacho: ONTEM }), false);
checar("A_RETIRAR posto no balcao ontem NAO conta",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: ONTEM }), false);
// Em EM_TRANSITO os dois carimbos agora dao no mesmo: qualquer um tira do card.
// A precedencia `coletadoEm ?? dataDespacho` segue existindo — e ela quem diz
// QUANDO saiu, para o chip de `carimboDaEtapa` —, mas nao muda mais o resultado.
checar("EM_TRANSITO com os dois carimbos nao conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, coletadoEm: HOJE_CEDO, dataDespacho: ONTEM }), false);
checar("EM_TRANSITO coletado ontem, despachado hoje, tambem nao conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, coletadoEm: ONTEM, dataDespacho: HOJE_CEDO }), false);

// ── 3. O CORTE POR DIA E NO FUSO DAQUI, nao em UTC ──────────────────────────
// So vale para A_RETIRAR agora: em EM_TRANSITO o dia deixou de importar,
// porque qualquer carimbo ja tira. O caso fica no balcao, que e onde a virada
// de dia ainda decide.
// 09/09 02:00 UTC ainda e 08/09 as 23:00 em Sao Paulo: saiu ONTEM.
checar("A_RETIRAR na virada: 09/09 02:00 UTC e ontem daqui, entao NAO conta",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: ONTEM_TARDE_UTC_DE_HOJE }), false);

// ── 4. SEM CARIMBO CONTINUA CONTANDO — A REDE DE SEGURANCA ──────────────────
// A excecao DELIBERADA da regra nova, e o motivo de ela nao ser "EM_TRANSITO
// nunca conta": sem carimbo, "saiu e perdeu o registro" e "nao saiu" sao
// indistinguiveis daqui, e so o segundo pede acao. Sumir do card e pior que
// sobrar nele. Em 09/09/2026 nao havia NENHUM pedido nessa situacao no painel:
// a excecao nao custa nada hoje e existe para o dia em que custar.
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

  // A GARANTIA DA REGRA SOBRE O PAINEL INTEIRO, com as duas metades:
  //   EM_TRANSITO — nenhum com carimbo, de qualquer dia;
  //   A_RETIRAR   — nenhum com carimbo de OUTRO dia (o de hoje continua valendo).
  const hojeAqui = diaSaoPaulo(new Date().toISOString());
  const saidaDe = (p: (typeof pedidos)[number]) =>
    p.etapa === "EM_TRANSITO"
      ? (p.expedicao?.coletadoEm ?? p.expedicao?.dataDespacho)
      : p.expedicao?.dataDespacho;

  const vazados = doDia.filter((p) => {
    if (!p.prometidoHoje) return false;
    const saida = saidaDe(p);
    if (p.etapa === "EM_TRANSITO") return Boolean(saida);
    if (p.etapa === "A_RETIRAR") return Boolean(saida) && diaSaoPaulo(saida!) !== hojeAqui;
    return false;
  });
  checar("nenhum pedido que ja saiu conta como prometido hoje", vazados.length, 0);

  // A REDE DE SEGURANCA NAO FOI LEVADA JUNTO: em transito SEM carimbo e com
  // promessa de hoje continua no card. E o caso que o corte tem de poupar.
  const transitoSemCarimbo = pedidos.filter((p) => p.etapa === "EM_TRANSITO" && !saidaDe(p));
  console.log(`   em transito sem carimbo no painel: ${transitoSemCarimbo.length}`);
  for (const p of transitoSemCarimbo) {
    if (p.dataPromessa?.slice(0, 10) !== hojeAqui) continue;
    checar(`#${p.idInt} em transito SEM carimbo, prometido hoje, continua no card`, ehDoDia(p), true);
  }

  // Os tres que a 2a decisao de 09/09 tirou do card, nomeados: eles ocupavam 3
  // das 7 linhas so por terem sido despachados de manha.
  for (const alvo of [21862, 21789, 21459]) {
    const p = pedidos.find((x) => x.idInt === alvo);
    if (!p) {
      console.log(`   (#${alvo} fora do painel nesta carga)`);
      continue;
    }
    checar(`#${alvo} em transito com carimbo esta FORA do card`, ehDoDia(p), false);
  }

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
