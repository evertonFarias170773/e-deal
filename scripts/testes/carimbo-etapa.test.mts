/**
 * A escolha do carimbo por etapa, no card do Kanban.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/carimbo-etapa.test.mts
 *
 * Existe porque o valor está na RECUSA: os quatro carimbos de `expedicoes` são
 * fotos do último acontecido, e ler "o que estiver preenchido" mostraria
 * "Despachado" num pedido que voltou para a fábrica — o caso do #21594.
 *
 * SÓ LEITURA na parte do banco; roda sem `PERMITIR_ESCRITA`.
 */
import { config as carregarEnv } from "dotenv";
import {
  carimboDaEtapa,
  dataHoraCurta,
  rotuloCarimbo
} from "../../src/features/expedicao/lib/carimbo-etapa.ts";
import type { PedidoExpedicao } from "../../src/features/expedicao/types.ts";

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

/** Todos os carimbos preenchidos, para provar que a etapa é que escolhe. */
const TODOS = {
  dataPronto: "2026-09-01T12:00:00Z",
  dataDespacho: "2026-09-02T21:50:00Z",
  coletadoEm: "2026-09-03T13:10:00Z",
  dataEntrega: "2026-09-04T18:30:00Z"
};

function pedido(etapa: string, exp: Partial<typeof TODOS> | null, statusInterno = "X"): PedidoExpedicao {
  return { idInt: 1, etapa, statusInterno, expedicao: exp } as unknown as PedidoExpedicao;
}

// ── 1. Cada etapa lê o SEU carimbo, com todos preenchidos ───────────────────
checar("PRONTO le dataPronto", carimboDaEtapa(pedido("PRONTO", TODOS)),
  { rotulo: "Pronto", instante: TODOS.dataPronto });
checar("A_RETIRAR le dataDespacho", carimboDaEtapa(pedido("A_RETIRAR", TODOS)),
  { rotulo: "No balcão", instante: TODOS.dataDespacho });
checar("ENTREGUE le dataEntrega", carimboDaEtapa(pedido("ENTREGUE", TODOS)),
  { rotulo: "Entregue", instante: TODOS.dataEntrega });

// ── 2. EM TRANSITO pelas DUAS entradas ──────────────────────────────────────
checar("EM_TRANSITO com coleta le coletadoEm e diz Coletado",
  carimboDaEtapa(pedido("EM_TRANSITO", TODOS)),
  { rotulo: "Coletado", instante: TODOS.coletadoEm });
checar("EM_TRANSITO sem coleta (Correios) le dataDespacho e diz Despachado",
  carimboDaEtapa(pedido("EM_TRANSITO", { dataDespacho: TODOS.dataDespacho })),
  { rotulo: "Despachado", instante: TODOS.dataDespacho });

// ── 3. Etapas SEM carimbo: status, nunca data ───────────────────────────────
// Mesmo com TODOS os carimbos preenchidos — é o caso do #21594, que tem
// `data_despacho` de uma passagem anterior e está em ACABAMENTO.
checar("PRODUCAO nao mostra data, mesmo com tudo preenchido",
  carimboDaEtapa(pedido("PRODUCAO", TODOS)), { rotulo: "Em produção", instante: null });
checar("ACABAMENTO nao mostra data, mesmo com tudo preenchido — o caso do 21594",
  carimboDaEtapa(pedido("ACABAMENTO", TODOS)), { rotulo: "Em acabamento", instante: null });
checar("ACABAMENTO nunca vira Despachado",
  rotuloCarimbo(pedido("ACABAMENTO", TODOS)).includes("Despachado"), false);

// ── 4. Carimbo ausente na etapa que o usa: rotulo sem data, card nunca mudo ─
checar("PRONTO sem dataPronto mostra so o verbo",
  rotuloCarimbo(pedido("PRONTO", { dataDespacho: TODOS.dataDespacho })), "Pronto");
checar("ENTREGUE sem dataEntrega mostra so o verbo",
  rotuloCarimbo(pedido("ENTREGUE", {})), "Entregue");
checar("sem linha em expedicoes mostra so o verbo",
  rotuloCarimbo(pedido("PRONTO", null)), "Pronto");
checar("etapa fora da tabela devolve o status cru",
  carimboDaEtapa(pedido("QUALQUER_OUTRA", TODOS, "REVISAO PRODUCAO")),
  { rotulo: "REVISAO PRODUCAO", instante: null });

// ── 5. A data sai no fuso de Sao Paulo, nao em UTC ──────────────────────────
// Os carimbos sao timestamptz em UTC; fatiar a string mostraria 3 horas a mais.
checar("21:50 UTC vira 18:50 em Sao Paulo", dataHoraCurta("2026-09-02T21:50:00Z"), "02/09 18:50");
checar("virada de dia: 01:30 UTC e o dia anterior aqui",
  dataHoraCurta("2026-09-03T01:30:00Z"), "02/09 22:30");
checar("nulo vira vazio", dataHoraCurta(null), "");
checar("data invalida vira vazio", dataHoraCurta("nao-e-data"), "");

// ── 6. O texto do chip ──────────────────────────────────────────────────────
checar("chip junta verbo e instante",
  rotuloCarimbo(pedido("EM_TRANSITO", { dataDespacho: "2026-09-02T21:50:00Z" })),
  "Despachado 02/09 18:50");

// ── 7. Contra a base real ───────────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { listarPainelExpedicao } = await import("../../src/features/expedicao/services/expedicao.service.ts");
  const pedidos = await listarPainelExpedicao();

  const porEtapa = new Map<string, string[]>();
  for (const p of pedidos) {
    porEtapa.set(p.etapa, [...(porEtapa.get(p.etapa) ?? []), `#${p.idInt} ${rotuloCarimbo(p)}`]);
  }
  console.log(`\npainel com ${pedidos.length} pedidos:`);
  for (const [etapa, linhas] of [...porEtapa.entries()].sort()) {
    console.log(`   ${etapa} (${linhas.length}) -> ex.: ${linhas.slice(0, 2).join(" | ")}`);
  }

  const COBERTAS = ["PRODUCAO", "ACABAMENTO", "PRONTO", "A_RETIRAR", "EM_TRANSITO", "ENTREGUE"];
  checar("nenhum pedido cai em etapa fora da tabela",
    [...porEtapa.keys()].every((e) => COBERTAS.includes(e)), true);
  checar("nenhum card fica mudo",
    pedidos.every((p) => rotuloCarimbo(p).trim() !== ""), true);
  checar("nenhum pedido em PRODUCAO ou ACABAMENTO mostra data",
    pedidos.filter((p) => p.etapa === "PRODUCAO" || p.etapa === "ACABAMENTO")
      .every((p) => carimboDaEtapa(p).instante === null), true);

  // A regra `coletadoEm ?? dataDespacho` nao pode mostrar instante ANTERIOR ao
  // despacho: coleta acontece depois dele, sempre.
  const emTransito = pedidos.filter((p) => p.etapa === "EM_TRANSITO");
  const invertidos = emTransito.filter((p) => {
    const c = carimboDaEtapa(p).instante;
    const d = p.expedicao?.dataDespacho;
    return c && d && new Date(c).getTime() < new Date(d).getTime();
  });
  checar("nenhum EM TRANSITO com carimbo anterior ao despacho", invertidos.length, 0);

  const p21594 = pedidos.find((p) => p.idInt === 21594);
  if (p21594) {
    console.log(`\n   #21594 etapa=${p21594.etapa} data_despacho=${p21594.expedicao?.dataDespacho ?? "-"}`);
    console.log(`   card mostra: "${rotuloCarimbo(p21594)}"`);
    checar("#21594 NAO mostra o data_despacho da passagem anterior",
      carimboDaEtapa(p21594).instante, null);
  } else {
    console.log("\n   (#21594 fora do painel nesta carga)");
  }
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
