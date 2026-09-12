/**
 * O filtro por status do pedido na Fila de Faturamento.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/fila-status.test.mts
 *
 * O que importa aqui e a COMBINACAO: o recorte por status tem de SOMAR aos dois
 * checkboxes, a busca e ao seletor de empresa — nunca substituir nenhum —, e as
 * contagens do drop tem de bater com o que a tela mostra depois de escolher.
 *
 * SO LEITURA; roda sem PERMITIR_ESCRITA.
 */
import { config as carregarEnv } from "dotenv";
import {
  opcoesStatusDaFila,
  statusVigenteDaFila,
  recortarPorStatus
} from "../../src/features/fiscal/lib/fila-status.ts";
import { humanizeStatus } from "../../src/lib/formatters/status.ts";

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
const TUDO = () => true;

// ── 1. As opcoes nascem do conjunto, ordenadas por frequencia ───────────────
const amostra = [
  { status_interno: "ENTREGUE" }, { status_interno: "ENTREGUE" }, { status_interno: "ENTREGUE" },
  { status_interno: "EM PRODUCAO" }, { status_interno: "EM PRODUCAO" },
  { status_interno: "CANCELADO" }
];
checar("so os status que existem, por frequencia",
  opcoesStatusDaFila(amostra, TUDO, humanizeStatus).map((o) => `${o.valor}:${o.quantidade}`),
  ["ENTREGUE:3", "EM PRODUCAO:2", "CANCELADO:1"]);
checar("o rotulo e o MESMO que a coluna da lista exibe",
  opcoesStatusDaFila(amostra, TUDO, humanizeStatus).map((o) => o.rotulo),
  ["Entregue", "EM PRODUCAO", "Cancelado"]);
checar("lista vazia nao inventa opcao", opcoesStatusDaFila([], TUDO, humanizeStatus), []);
checar("status vazio ou em branco nao vira opcao",
  opcoesStatusDaFila([{ status_interno: "" }, { status_interno: "   " }, { status_interno: null }], TUDO, humanizeStatus),
  []);
checar("espaco em volta nao cria status duplicado",
  opcoesStatusDaFila([{ status_interno: "ENTREGUE" }, { status_interno: " ENTREGUE " }], TUDO, humanizeStatus)
    .map((o) => `${o.valor}:${o.quantidade}`),
  ["ENTREGUE:2"]);

// ── 2. A CONTAGEM CONSIDERA OS OUTROS FILTROS ───────────────────────────────
const comFaturado = [
  { status_interno: "ENTREGUE", faturado: true }, { status_interno: "ENTREGUE", faturado: false },
  { status_interno: "ENTREGUE", faturado: false }, { status_interno: "EM PRODUCAO", faturado: true }
];
checar("sem filtro: Entregue conta 3",
  opcoesStatusDaFila(comFaturado, TUDO, humanizeStatus).find((o) => o.valor === "ENTREGUE")?.quantidade, 3);
checar("com 'So faturados': Entregue conta 1, nao 3",
  opcoesStatusDaFila(comFaturado, (i) => i.faturado, humanizeStatus).find((o) => o.valor === "ENTREGUE")?.quantidade, 1);
checar("com 'So faturados', EM PRODUCAO continua 1",
  opcoesStatusDaFila(comFaturado, (i) => i.faturado, humanizeStatus).find((o) => o.valor === "EM PRODUCAO")?.quantidade, 1);

// ── 3. O recorte SOMA aos outros, nunca substitui ───────────────────────────
const outros = comFaturado.filter((i) => i.faturado);
checar("status + 'So faturados' devolve a intersecao",
  recortarPorStatus(outros, "ENTREGUE").length, 1);
checar("'Todos os status' devolve o que os outros filtros deixaram",
  recortarPorStatus(outros, "").length, 2);
checar("recorte nao mexe no array de origem", outros.length, 2);

// ── 4. Escolha que saiu da fila e IGNORADA, nao zera a tela ─────────────────
const opcoes = opcoesStatusDaFila(amostra, TUDO, humanizeStatus);
checar("status que existe permanece", statusVigenteDaFila("ENTREGUE", opcoes), "ENTREGUE");
checar("status que sumiu da fila e ignorado", statusVigenteDaFila("EM TRANSITO", opcoes), "");
checar("status de link antigo na URL e ignorado", statusVigenteDaFila("QUALQUER_COISA", opcoes), "");
checar("vazio continua vazio", statusVigenteDaFila("", opcoes), "");
checar("ignorado devolve a fila inteira, nao vazia",
  recortarPorStatus(amostra, statusVigenteDaFila("EM TRANSITO", opcoes)).length, amostra.length);

// ── 5. A soma das opcoes bate com o total ───────────────────────────────────
checar("a soma das contagens e o total do conjunto",
  opcoesStatusDaFila(amostra, TUDO, humanizeStatus).reduce((s, o) => s + o.quantidade, 0), amostra.length);

// ── 6. Contra a FILA REAL, pelo mesmo servico que a tela usa ────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { getFaturaveisPropostas } = await import("../../src/features/nfe/services/nfe.service.ts");
  const fila = await getFaturaveisPropostas();

  // Os mesmos predicados da tela, nas combinacoes que importam.
  // Copia fiel do predicado da tela (NotasFiscaisPage.tsx:130).
  const ehFaturado = (t?: string | null) => String(t ?? "").trim().toUpperCase() === "E-FATURADO";
  const padrao = (i: (typeof fila)[number]) => (i.notas_vivas ?? 0) === 0;
  const comJaFaturadas = () => true;
  const soFaturados = (i: (typeof fila)[number]) => padrao(i) && ehFaturado(i.tipo_cobranca);
  const empresa1 = (i: (typeof fila)[number]) => padrao(i) && String(i.id_empresa) === "1";

  const cenarios: Array<[string, (i: (typeof fila)[number]) => boolean]> = [
    ["padrao (nenhum checkbox)", padrao],
    ["+ Permitir faturar de novo", comJaFaturadas],
    ["+ So faturados", soFaturados],
    ["+ Empresa 1 (Ingresso Ideal)", empresa1]
  ];

  for (const [nome, pred] of cenarios) {
    const ops = opcoesStatusDaFila(fila, pred, humanizeStatus);
    const base = fila.filter(pred);
    console.log(`\n${"─".repeat(72)}\n${nome} — a aba mostra (${base.length})\n${"─".repeat(72)}`);
    console.log(`   Todos os status do pedido (${ops.reduce((s, o) => s + o.quantidade, 0)})`);
    for (const o of ops) {
      const aoEscolher = recortarPorStatus(base, o.valor).length;
      const bate = aoEscolher === o.quantidade;
      if (!bate) falhas += 1;
      console.log(`   ${o.rotulo.padEnd(20)} (${String(o.quantidade).padStart(2)})  ao escolher, a tela mostra ${aoEscolher}${bate ? "" : "   <<< DIVERGIU"}`);
    }
    checar(`[${nome}] a soma das opcoes = total do conjunto`,
      ops.reduce((s, o) => s + o.quantidade, 0), base.filter((i) => String(i.status_interno ?? "").trim()).length);
  }

  // A busca por texto e mais uma dimensao: tem de somar tambem. O termo sai da
  // propria fila — a `ref` do primeiro pedido —, para recortar de verdade em
  // qualquer base, em vez de depender de uma letra que casa com tudo.
  const termo = String(fila.filter(padrao)[0]?.ref_origem ?? "").toLowerCase();
  const comBusca = (i: (typeof fila)[number]) =>
    padrao(i) && String(i.ref_origem ?? "").toLowerCase().includes(termo);
  const opsBusca = opcoesStatusDaFila(fila, comBusca, humanizeStatus);
  const baseBusca = fila.filter(comBusca);
  console.log(`\n${"─".repeat(72)}\n+ busca por "${termo}" — a aba mostra (${baseBusca.length})\n${"─".repeat(72)}`);
  for (const o of opsBusca)
    console.log(`   ${o.rotulo.padEnd(20)} (${String(o.quantidade).padStart(2)})  ao escolher: ${recortarPorStatus(baseBusca, o.valor).length}`);
  checar("busca + status somam", opsBusca.every((o) => recortarPorStatus(baseBusca, o.valor).length === o.quantidade), true);
  checar("a busca de fato recortou", baseBusca.length < fila.filter(padrao).length, true);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
