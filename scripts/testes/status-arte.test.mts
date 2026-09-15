/**
 * "Status Arte" da lista de Orcamentos e o selo do cabecalho do pedido.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/status-arte.test.mts
 *
 * O que se prova aqui e a IGUALDADE entre as duas telas: a lista carrega em
 * lote por pagina (buscarStatusArteDasPropostas) e o cabecalho carrega um
 * pedido por vez (buscarStatusArteDaProposta). Dois caminhos de consulta
 * diferentes para o mesmo valor — o teste exige que devolvam o mesmo texto e
 * a mesma cor, pedido a pedido. O botao do painel do cliente nao depende mais
 * do status da arte (15/09/2026): so do link ativo, decidido na tela.
 *
 * SO LEITURA; roda sem PERMITIR_ESCRITA.
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

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (SERVICE) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const {
  classeDoStatusArte,
  buscarStatusArteDasPropostas,
  buscarStatusArteDaProposta
} = await import("../../src/features/orcamentos/services/status-arte-lista.service.ts");

// ── 1. As cores, pela decisao do dono ───────────────────────────────────────
const VERDE = "border-teal-200 bg-teal-50 text-teal-700";
const LARANJA = "border-orange-200 bg-orange-50 text-orange-700";
const VERMELHO = "border-red-200 bg-red-50 text-red-700";
const AZUL = "border-sky-200 bg-sky-50 text-sky-800";
const NEUTRO = "border-slate-200 bg-slate-50 text-slate-600";

checar("APROVADO e verde", classeDoStatusArte("APROVADO"), VERDE);
checar("Em Aprovação e laranja", classeDoStatusArte("Em Aprovação"), LARANJA);
checar("Apr Parcial e laranja", classeDoStatusArte("Apr Parcial"), LARANJA);
checar("Em Alteração e vermelho", classeDoStatusArte("Em Alteração"), VERMELHO);
checar("Corrigir Dados e vermelho", classeDoStatusArte("Corrigir Dados"), VERMELHO);
checar("EM ARTE e azul", classeDoStatusArte("EM ARTE"), AZUL);
checar("ENVIAR ARTE e azul", classeDoStatusArte("ENVIAR ARTE"), AZUL);
checar("Dados Pendentes e azul", classeDoStatusArte("Dados Pendentes"), AZUL);
checar("vazio e neutro", classeDoStatusArte(""), NEUTRO);
checar("nulo e neutro", classeDoStatusArte(null), NEUTRO);
checar("valor desconhecido e neutro", classeDoStatusArte("QUALQUER COISA NOVA"), NEUTRO);

// ── 2. Caixa e acento nao importam ──────────────────────────────────────────
checar("EM ALTERACAO sem acento = Em Alteração", classeDoStatusArte("EM ALTERACAO"), VERMELHO);
checar("em aprovacao minusculo = Em Aprovação", classeDoStatusArte("em aprovacao"), LARANJA);
checar("aprovado minusculo = APROVADO", classeDoStatusArte("aprovado"), VERDE);
checar("espacos duplos e bordas nao importam", classeDoStatusArte("  Dados   Pendentes "), AZUL);

// ── 3. LISTA x CABECALHO, contra o banco ────────────────────────────────────
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

  // Um pedido por status distinto, para cobrir as cores.
  const { data: linhas } = await sb.from("pedidos_artes").select("id_int, status").order("id_int");
  const umPorStatus = new Map<string, number>();
  for (const l of linhas ?? []) {
    const k = String(l.status ?? "");
    if (!umPorStatus.has(k)) umPorStatus.set(k, Number(l.id_int));
  }
  const amostra = [...umPorStatus.values()];

  // E um pedido SEM linha em pedidos_artes, para o caso vazio.
  const { data: props } = await sb.from("propostas").select("id_int").order("id_int", { ascending: false }).limit(400);
  const comLinha = new Set((linhas ?? []).map((l) => Number(l.id_int)));
  const semLinha = (props ?? []).map((p) => Number(p.id_int)).find((id) => !comLinha.has(id));
  if (semLinha) amostra.push(semLinha);

  const daLista = await buscarStatusArteDasPropostas(amostra); // o lote, como a pagina faz

  console.log(`\n${"=".repeat(96)}\nLISTA x CABECALHO — ${amostra.length} pedidos, um por status distinto + um sem linha\n${"=".repeat(96)}`);
  console.log("pedido   lista                cabecalho            mesma cor  igual");
  console.log("-".repeat(96));
  let iguais = 0;
  for (const id of amostra) {
    const lista = daLista[id] ?? null;
    const cabecalho = await buscarStatusArteDaProposta(id); // um por vez, como o cabecalho faz
    const mesmaCor = classeDoStatusArte(lista) === classeDoStatusArte(cabecalho);
    const igual = lista === cabecalho && mesmaCor;
    if (igual) iguais += 1;
    else falhas += 1;
    console.log(
      `${String(id).padEnd(8)} ${String(lista ?? "(vazio)").padEnd(20)} ${String(cabecalho ?? "(vazio)").padEnd(20)} ` +
        `${String(mesmaCor).padEnd(10)} ${igual ? "SIM" : "NAO <<<"}`
    );
  }
  checar(`as duas telas concordam nos ${amostra.length} pedidos`, iguais, amostra.length);

  // Quantos status DISTINTOS existem para testar, depois de aparar. Nao e uma
  // assercao: e um dado do banco, fora do controle deste teste. Em 13/09/2026 a
  // tabela tinha 110 linhas e UM so status exibivel (APROVADO, uma delas
  // gravada como "\r\nAPROVADO"). As cores de cada status decidido estao
  // cobertas pelas assercoes de unidade das secoes 1 e 2.
  const distintos = new Set((linhas ?? []).map((l) => String(l.status ?? "").trim()).filter(Boolean));
  console.log(`\n  status exibiveis distintos hoje em pedidos_artes: ${distintos.size} -> ${[...distintos].join(", ")}`);
  if (distintos.size < 3) {
    console.log("  AVISO: menos de 3 status distintos no banco — a igualdade entre as telas foi");
    console.log("         provada nos valores que existem; as cores, nas assercoes de unidade.");
  }
  checar("o pedido sem linha fica vazio nas duas", semLinha ? daLista[semLinha] === undefined : true, true);

  // O valor exibido e o gravado, byte a byte: sem derivacao nenhuma.
  const cruDoBanco = new Map((linhas ?? []).map((l) => [Number(l.id_int), String(l.status ?? "").trim()]));
  checar("a lista exibe exatamente o que esta em pedidos_artes.status",
    amostra.filter((id) => cruDoBanco.has(id) && cruDoBanco.get(id)).every((id) => daLista[id] === cruDoBanco.get(id)),
    true);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
