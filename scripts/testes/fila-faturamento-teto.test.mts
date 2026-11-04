/**
 * A Fila de Faturamento não perde pedido nem cobrança pelo teto de 1.000 linhas
 * (04/11/2026).
 *
 * O QUE PROVA, por condição (nunca por contagem fixa), contra a base real:
 *   1. a fila tem EXATAMENTE os pedidos que a regra dá numa leitura direta e
 *      independente (libera_nf, sem faturado fora, sem encerrado teste, cliente
 *      sem nota = false), sem repetição;
 *   2. o 22721 está na fila e a busca da tela por "22721" o acha;
 *   3. o pedido mais novo da regra continua na fila;
 *   4. o tipo de cobrança e o selo de retrabalho batem com a leitura direta das
 *      cobranças, inclusive nos pedidos das cobranças MAIS RECENTES;
 *   5. pedido com NF-e de venda viva vem com notas_vivas > 0 (a tela o esconde
 *      por padrão) e o de cliente "não recebe nota" não vem.
 *
 * SÓ LEITURA. Chave de serviço, como os outros testes de painel; qualquer
 * escrita falha o teste.
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/fila-faturamento-teto.test.mts
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_DB = process.env.NEXT_PUBLIC_SUPABASE_URL;

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

if (!URL_DB || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (alvo: string | URL | Request, init?: RequestInit) => {
    const metodo = (init?.method ?? (alvo instanceof Request ? alvo.method : "GET")).toUpperCase();
    if (metodo !== "GET" && metodo !== "HEAD") throw new Error("TESTE TENTOU ESCREVER: " + String(alvo));
    return fetchOriginal(alvo, init);
  }) as typeof fetch;

  const { getFaturaveisPropostas } = await import("../../src/features/nfe/services/nfe.service.ts");
  const { cobrancaEhRetrabalho, marcaDeRetrabalho } = await import("../../src/lib/retrabalho.ts");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(URL_DB, SERVICE, { auth: { persistSession: false } });

  const fila = await getFaturaveisPropostas();
  const naFila = new Map(fila.map((f) => [f.id_int, f]));
  console.log(`\n>>> fila com ${fila.length} pedidos\n`);

  // Leitura direta e independente: páginas por range, lotes de 100 ids.
  async function paginado<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const linhas: T[] = [];
    for (let de = 0; ; de += 500) {
      const { data, error } = await montar(de, de + 499);
      if (error) throw new Error(JSON.stringify(error));
      linhas.push(...(data ?? []));
      if ((data ?? []).length < 500) break;
    }
    return linhas;
  }
  async function emLotes<T>(ids: number[], montar: (lote: number[]) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const linhas: T[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await montar(ids.slice(i, i + 100));
      if (error) throw new Error(JSON.stringify(error));
      if ((data ?? []).length >= 1000) throw new Error("lote do teste cortou");
      linhas.push(...(data ?? []));
    }
    return linhas;
  }

  type P = { id_int: number; id_cliente: number | null; motivo_copia: string | null; id_int_origem_copia: number | null };
  const elegiveis = await paginado<P>((de, ate) =>
    db.from("propostas").select("id_int,id_cliente,motivo_copia,id_int_origem_copia")
      .eq("libera_nf", true).is("faturado_fora_em", null).is("encerrado_teste_em", null)
      .order("id_int", { ascending: true }).range(de, ate)
  );
  const idsCliente = [...new Set(elegiveis.map((p) => Number(p.id_cliente)).filter((n) => n > 0))];
  const clientes = await emLotes<{ id_cliente: number; nota: boolean | null }>(idsCliente, (l) => db.from("clientes").select("id_cliente,nota").in("id_cliente", l));
  const semNota = new Set(clientes.filter((c) => c.nota === false).map((c) => Number(c.id_cliente)));
  const esperados = elegiveis.filter((p) => !semNota.has(Number(p.id_cliente)));
  const idsEsperados = esperados.map((p) => p.id_int).sort((a, b) => a - b);

  // 1. O conjunto.
  checar("fila = regra lida direto no banco (mesmos pedidos)", [...naFila.keys()].sort((a, b) => a - b), idsEsperados);
  checar("fila sem pedido repetido", naFila.size, fila.length);
  checar("a fila passa de 1.000 (o teto foi de fato atravessado)", fila.length > 1000, idsEsperados.length > 1000);

  // 2. Um pedido ALÉM do milésimo (o que a leitura antiga cortava) e a busca da
  //    tela por ele (número do pedido em ref_origem). Era o 22721 em 04/11; ele
  //    foi marcado faturado no sistema antigo depois, então a prova escolhe o
  //    pedido na hora, sempre fora das 1.000 primeiras linhas da consulta.
  const decrescente = [...idsEsperados].reverse();
  const alemDoMilesimo = decrescente[decrescente.length - 1];
  console.log(`        pedido além do milésimo: ${alemDoMilesimo} (posição ${decrescente.length} em ordem decrescente)`);
  checar("há pedido além do milésimo na regra (a prova não é vazia)", decrescente.length > 1000, true);
  checar("o pedido além do milésimo está na fila", naFila.has(alemDoMilesimo), true);
  const busca = fila.filter((f) => f.ref_origem.toLowerCase().includes(String(alemDoMilesimo)));
  checar("a busca pelo número dele o acha", busca.some((f) => f.id_int === alemDoMilesimo), true);
  checar("o 22721 segue a regra (na fila se e só se a regra o inclui)", naFila.has(22721), esperados.some((p) => p.id_int === 22721));

  // 3. O mais novo.
  const maisNovo = Math.max(...idsEsperados);
  checar(`o pedido mais novo da regra (${maisNovo}) está na fila`, naFila.has(maisNovo), true);

  // 4. Cobranças: tipo exibido e selo de retrabalho, contra a leitura direta.
  type C = { id_int: number; tipo_cobranca: string | null; status: string | null; created_at: string };
  const cobrancas = await emLotes<C>(idsEsperados, (l) =>
    db.from("pagamentos_v2").select("id_int,tipo_cobranca,status,created_at").in("id_int", l).order("created_at", { ascending: true })
  );
  const tipoEsperado = new Map<number, string>();
  const comRetrabalho = new Set<number>();
  for (const c of cobrancas) {
    if (cobrancaEhRetrabalho(c)) comRetrabalho.add(c.id_int);
    const t = String(c.tipo_cobranca ?? "").trim();
    if (t) tipoEsperado.set(c.id_int, t);
  }
  const divergeTipo = idsEsperados.filter((id) => (naFila.get(id)?.tipo_cobranca ?? null) !== (tipoEsperado.get(id) ?? null));
  checar("tipo de cobrança de todo pedido igual à leitura direta", divergeTipo, []);
  const porId = new Map(esperados.map((p) => [p.id_int, p]));
  const divergeSelo = idsEsperados.filter(
    (id) => (naFila.get(id)?.isRetrabalho ?? false) !== (marcaDeRetrabalho(porId.get(id)!, comRetrabalho.has(id)) !== null)
  );
  checar("selo de retrabalho de todo pedido igual à leitura direta", divergeSelo, []);
  const recentes = [...cobrancas].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200).map((c) => c.id_int);
  const recentesComTipo = [...new Set(recentes)].filter((id) => tipoEsperado.has(id));
  checar(
    "pedidos das 200 cobranças mais recentes chegam com o tipo",
    recentesComTipo.filter((id) => !naFila.get(id)?.tipo_cobranca),
    []
  );
  checar("existe cobrança total acima de 1.000 (a leitura antiga cortaria)", cobrancas.length > 1000, true);

  // 5. Nota viva e cliente sem nota.
  type N = { id_int: number; status: string | null; tipo_nota: string | null };
  const notas = await emLotes<N>(idsEsperados, (l) => db.from("notas_fiscais").select("id_int,status,tipo_nota").in("id_int", l));
  const vivas = new Set(
    notas
      .filter((n) => !["CANCELADA", "DENEGADA", "PENDENTE", "RASCUNHO"].includes(String(n.status ?? "").toUpperCase()))
      .filter((n) => String(n.tipo_nota ?? "").trim().toUpperCase() !== "REMESSA")
      .map((n) => n.id_int)
  );
  checar("todo pedido com NF-e viva vem com notas_vivas > 0 (escondido por padrão)", [...vivas].filter((id) => !((naFila.get(id)?.notas_vivas ?? 0) > 0)), []);
  checar("nenhum pedido sem NF-e viva vem com notas_vivas > 0", idsEsperados.filter((id) => !vivas.has(id) && (naFila.get(id)?.notas_vivas ?? 0) > 0), []);
  const deClienteSemNota = elegiveis.filter((p) => semNota.has(Number(p.id_cliente))).map((p) => p.id_int);
  checar("pedido de cliente 'não recebe nota' fica fora", deClienteSemNota.filter((id) => naFila.has(id)), []);
  checar("há pedido de cliente 'não recebe nota' para provar o corte", deClienteSemNota.length > 0, true);
}

console.log(falhas === 0 ? "\ntudo certo" : `\n${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
