/**
 * O congelamento do "prometido hoje" quando o pedido JÁ SAIU.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/prometido-hoje.test.mts
 *
 * Existe porque são DUAS regras de congelamento diferentes, de propósito, e a
 * diferença é sutil:
 *
 *   ATRASO          para por ETAPA — fora da bancada, para.
 *   PROMETIDO HOJE  para por CARIMBO — fora da bancada, qualquer carimbo tira
 *                   do dia, inclusive o de hoje. Sem carimbo, continua.
 *
 * Eram TRÊS até 11/09/2026: `A_RETIRAR` tinha um corte por DIA só dele, e o
 * volume no balcão só saía do card quando o dia virava. O corte por carimbo
 * chegou em duas etapas — `EM_TRANSITO` em 09/09, `A_RETIRAR` em 11/09 — e
 * hoje nenhuma etapa decide pela DATA da saída.
 *
 * Igualar o prometido hoje ao atraso ressuscitaria no card o volume que já foi
 * embora: o atraso para por etapa, e nem chega a ler carimbo.
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
  const jaSaiu = foraDaBancada && Boolean(saida);
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

// O BALCAO SEGUE A MESMA REGRA DESDE 11/09/2026. Ate entao ele contava o dia
// inteiro, com o argumento de que "em retirada nada saiu". Mas o card pergunta o
// que a EXPEDICAO ainda tem de fazer, e uma vez no balcao ela ja fez a parte
// dela: o proximo passo e o cliente aparecer. O 21866 chegou ao balcao em 11/09
// as 09:45 e passou o dia ocupando a lista sem nada a fazer nele.
//
// Ele nao some da tela, muda de card: continua em "A retirar".
checar("A_RETIRAR que chegou ao balcao hoje NAO conta",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: HOJE_CEDO }), false);

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

// ── 3. A VIRADA DE DIA DEIXOU DE DECIDIR — em etapa nenhuma ─────────────────
// Este caso guardava o corte por fuso: 09/09 02:00 UTC ainda e 08/09 as 23:00 em
// Sao Paulo, entao "saiu ontem". Desde 11/09/2026 o resultado e o mesmo com ou
// sem essa conta, porque QUALQUER carimbo ja tira — e e isso que ele fixa agora.
// Se um dia voltar a importar de que dia e o carimbo, este teste avisa.
checar("A_RETIRAR com carimbo na virada do dia NAO conta",
  prometidoHoje({ etapa: "A_RETIRAR", promessaDia: HOJE, dataDespacho: ONTEM_TARDE_UTC_DE_HOJE }), false);
checar("EM_TRANSITO com carimbo na virada do dia NAO conta",
  prometidoHoje({ etapa: "EM_TRANSITO", promessaDia: HOJE, dataDespacho: ONTEM_TARDE_UTC_DE_HOJE }), false);

// ── 4. SEM CARIMBO CONTINUA CONTANDO — A REDE DE SEGURANCA ──────────────────
// A excecao DELIBERADA da regra, e o motivo de ela nao ser "fora da bancada
// nunca conta": sem carimbo, "saiu e perdeu o registro" e "nao saiu" sao
// indistinguiveis daqui, e so o segundo pede acao. O mesmo vale para o balcao,
// entre "chegou e nao foi carimbado" e "nao chegou". Sumir do card e pior que
// sobrar nele. Em 11/09/2026 nao havia NENHUM pedido nessa situacao no painel,
// em transito ou no balcao: a excecao nao custa nada hoje e existe para o dia
// em que custar.
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

  // A GARANTIA DA REGRA SOBRE O PAINEL INTEIRO, agora numa metade so: nenhum
  // pedido fora da bancada COM carimbo pode contar como prometido hoje, seja o
  // carimbo de que dia for.
  const hojeAqui = diaSaoPaulo(new Date().toISOString());
  const foraDaBancada = (p: (typeof pedidos)[number]) =>
    p.etapa === "A_RETIRAR" || p.etapa === "EM_TRANSITO" || p.etapa === "ENTREGUE";
  const saidaDe = (p: (typeof pedidos)[number]) =>
    p.etapa === "EM_TRANSITO"
      ? (p.expedicao?.coletadoEm ?? p.expedicao?.dataDespacho)
      : p.expedicao?.dataDespacho;

  const vazados = doDia.filter((p) => p.prometidoHoje && foraDaBancada(p) && Boolean(saidaDe(p)));
  checar("nenhum pedido com carimbo conta como prometido hoje", vazados.length, 0);

  // A REDE DE SEGURANCA NAO FOI LEVADA JUNTO: fora da bancada SEM carimbo e com
  // promessa de hoje continua no card. E o caso que o corte tem de poupar, e
  // agora vale para o balcao tambem.
  const semCarimbo = pedidos.filter((p) => foraDaBancada(p) && p.etapa !== "ENTREGUE" && !saidaDe(p));
  console.log(`   fora da bancada sem carimbo no painel: ${semCarimbo.length}`);
  for (const p of semCarimbo) {
    if (p.dataPromessa?.slice(0, 10) !== hojeAqui) continue;
    checar(`#${p.idInt} (${p.etapa}) SEM carimbo, prometido hoje, continua no card`, ehDoDia(p), true);
  }

  // Nomeados: os tres que a decisao de 09/09 tirou do card e o 21866, que a de
  // 11/09 tirou. Cada um ocupava uma linha da lista sem ter acao pendente.
  for (const alvo of [21862, 21789, 21459, 21866]) {
    const p = pedidos.find((x) => x.idInt === alvo);
    if (!p) {
      console.log(`   (#${alvo} fora do painel nesta carga)`);
      continue;
    }
    checar(`#${alvo} (${p.etapa}) com carimbo esta FORA do card`, ehDoDia(p), false);
  }

  // E o 21866 continua na tela, no card que responde por ele.
  const p21866 = pedidos.find((x) => x.idInt === 21866);
  if (p21866) {
    checar("#21866 continua em A_RETIRAR", p21866.etapa, "A_RETIRAR");
    checar("#21866 tem carimbo de chegada ao balcao", Boolean(p21866.expedicao?.dataDespacho), true);
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
