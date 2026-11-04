/**
 * Leitura paginada única (src/lib/supabase/ler-todas.ts) e os dois pontos dos
 * boletos que passaram a usá-la (04/11/2026).
 *
 * O QUE PROVA, por condição (nunca por contagem fixa):
 *   A. o ajudante, contra um banco falso: páginas pela chave, sem repetir nem
 *      pular, `completo`, erro e teto; lerPorIds pagina dentro do lote;
 *   B. contra a base real (só leitura, chave de serviço):
 *      1. a lista de títulos do CobrancasProvider tem TODAS as linhas de
 *         boletos, igual a uma leitura direta independente;
 *      2. um pedido cujo título estava entre os cortados pela leitura antiga
 *         passa a ter título ativo (o aviso do Cancelar proposta aparece);
 *      3. o Contas a Receber traz todos os boletos, os antigos inclusive, e a
 *         soma dos valores bate com a leitura direta;
 *      4. em relação à leitura antiga, só ENTRAM os títulos antes cortados:
 *         nada sai e nenhuma linha já vista muda;
 *      5. duas leituras seguidas devolvem o mesmo resultado.
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/ler-todas-boletos.test.mts
 */
import { config as carregarEnv } from "dotenv";
import { lerTodas, lerPorIds, type ConsultaPaginavel, type RespostaDeConsulta } from "@/lib/supabase/ler-todas";
import { pedidosComBoleto } from "@/features/cobrancas/lib/pedidos-com-boleto";

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

// ── A. O AJUDANTE, CONTRA UM BANCO FALSO ────────────────────────────────────
type Linha = { id: number; grupo: number };
function bancoFalso(linhas: Linha[], tetoDoBanco = 1000, falharNaPagina = -1) {
  let paginas = 0;
  const consulta = (filtros: Array<(l: Linha) => boolean>, ordem: "asc" | "desc" = "asc", lim = Infinity): ConsultaPaginavel<Linha> => ({
    gt: (c, v) => consulta([...filtros, (l) => (l as Record<string, unknown>)[c] as number > (v as number)], ordem, lim),
    lt: (c, v) => consulta([...filtros, (l) => (l as Record<string, unknown>)[c] as number < (v as number)], ordem, lim),
    order: (_c, o) => consulta(filtros, o.ascending ? "asc" : "desc", lim),
    limit: (n) => consulta(filtros, ordem, n),
    then<R1 = RespostaDeConsulta<Linha>, R2 = never>(ok?: ((v: RespostaDeConsulta<Linha>) => R1 | PromiseLike<R1>) | null, ko?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      paginas += 1;
      const r: RespostaDeConsulta<Linha> =
        paginas === falharNaPagina
          ? { data: null, error: { message: "falha simulada" } }
          : {
              data: linhas
                .filter((l) => filtros.every((f) => f(l)))
                .sort((a, b) => (ordem === "asc" ? a.id - b.id : b.id - a.id))
                .slice(0, Math.min(lim, tetoDoBanco)),
              error: null
            };
      return Promise.resolve(r).then(ok, ko);
    }
  });
  return { base: (filtro?: (l: Linha) => boolean) => consulta(filtro ? [filtro] : []), paginas: () => paginas };
}
const dados = Array.from({ length: 2345 }, (_, i) => ({ id: i * 3 + 1, grupo: i % 7 }));
{
  const b = bancoFalso(dados);
  const r = await lerTodas(() => b.base(), { chave: "id" });
  checar("lerTodas: lê as 2.345 linhas, completo", [r.data.length, r.completo, r.error], [2345, true, null]);
  checar("lerTodas: sem repetir nem pular", JSON.stringify(r.data.map((l) => l.id)) === JSON.stringify(dados.map((l) => l.id)), true);
  checar("lerTodas: 3 páginas", b.paginas(), 3);
}
{
  const b = bancoFalso(dados);
  const r = await lerTodas(() => b.base(), { chave: "id", ordem: "desc" });
  checar("lerTodas desc: mesmas linhas, ordem decrescente", [r.data.length, r.data[0].id, r.data.at(-1)?.id], [2345, dados.at(-1)!.id, 1]);
}
{
  const b = bancoFalso(dados.slice(0, 1000));
  const r = await lerTodas(() => b.base(), { chave: "id" });
  checar("lerTodas: exatamente 1.000 pede mais uma página e fecha", [r.data.length, r.completo, b.paginas()], [1000, true, 2]);
}
{
  const b = bancoFalso(dados, 1000, 2);
  const r = await lerTodas(() => b.base(), { chave: "id" });
  checar("lerTodas: erro na 2ª página = incompleto com erro", [r.completo, r.error?.message], [false, "falha simulada"]);
}
{
  const b = bancoFalso(dados);
  const r = await lerTodas(() => b.base(), { chave: "id", teto: 1500 });
  checar("lerTodas: passou do teto = incompleto com erro", [r.completo, /teto/.test(r.error?.message ?? "")], [false, true]);
}
{
  const b = bancoFalso([]);
  const r = await lerTodas(() => b.base(), { chave: "id" });
  checar("lerTodas: vazio é completo", [r.data.length, r.completo], [0, true]);
}
{
  // Lote cujo resultado passa de 1.000: lerPorIds pagina dentro dele.
  const b = bancoFalso(dados);
  const grupos = [0, 1, 2, 3, 4, 5, 6];
  const r = await lerPorIds(grupos, (lote) => b.base((l) => lote.includes(l.grupo)), { chave: "id", idsPorLote: 3 });
  checar("lerPorIds: todas as linhas dos ids, completo", [r.data.length, r.completo], [2345, true]);
  checar("lerPorIds: sem repetir", new Set(r.data.map((l) => l.id)).size, 2345);
}

// ── B. CONTRA A BASE REAL ───────────────────────────────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_DB = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL_DB || !SERVICE) {
  console.log("(sem chaves: parte B pulada)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (alvo: string | URL | Request, init?: RequestInit) => {
    const metodo = (init?.method ?? (alvo instanceof Request ? alvo.method : "GET")).toUpperCase();
    if (metodo !== "GET" && metodo !== "HEAD") throw new Error("TESTE TENTOU ESCREVER: " + String(alvo));
    return fetchOriginal(alvo, init);
  }) as typeof fetch;

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(URL_DB, SERVICE, { auth: { persistSession: false } });
  const { getContasReceberReadOnlyData, CONTAS_RECEBER_SELECT } = await import("../../src/features/contas-a-receber/services/contas-receber.service.ts");

  // Leitura direta INDEPENDENTE: offset por range, ordenada por created_at e id.
  type B = { id: string; id_int: number | null; status: string | null; valor: number | null; created_at: string };
  const direta: B[] = [];
  for (let de = 0; ; de += 500) {
    const { data, error } = await db.from("boletos").select("id,id_int,status,valor,created_at").order("created_at").order("id").range(de, de + 499);
    if (error) throw new Error(error.message);
    direta.push(...((data ?? []) as B[]));
    if ((data ?? []).length < 500) break;
  }
  const { count } = await db.from("boletos").select("id", { count: "exact", head: true });
  checar("leitura direta tem a contagem exata da tabela", direta.length, count);
  console.log(`\n>>> boletos na base: ${direta.length}\n`);

  // As leituras ANTIGAS, exatamente como eram.
  const antigaProvider = await db.from("boletos").select("id_int, status").limit(30000);
  const antigaCR = await db.from("boletos").select("id").order("created_at", { ascending: false }).limit(5000);
  const idsAntigosCR = new Set((antigaCR.data ?? []).map((l: { id: string }) => l.id));

  // 1. Provider: mesma leitura nova da tela.
  const leituraNova = () => lerTodas<{ id: string; id_int: number | null; status: string | null }>(() => db.from("boletos").select("id, id_int, status"), { chave: "id" });
  const nova = await leituraNova();
  checar("Provider: leitura nova completa e sem erro", [nova.completo, nova.error], [true, null]);
  checar("Provider: mesmas linhas da leitura direta", nova.data.map((l) => l.id).sort(), direta.map((l) => l.id).sort());
  const novoConjunto = pedidosComBoleto(nova.data);
  const diretoConjunto = pedidosComBoleto(direta);
  checar("Provider: todo pedido com título ativo entra", [...novoConjunto.ativos].sort((a, b) => a - b), [...diretoConjunto.ativos].sort((a, b) => a - b));
  checar("Provider: histórico igual ao direto", [...novoConjunto.historico].sort((a, b) => a - b), [...diretoConjunto.historico].sort((a, b) => a - b));

  // 2. Pedido cortado ganha o aviso do Cancelar proposta (temTituloAtivo = ativos.has).
  const antigoConjunto = pedidosComBoleto((antigaProvider.data ?? []) as B[]);
  const cortadosComAtivo = [...diretoConjunto.ativos].filter((id) => !antigoConjunto.ativos.has(id));
  console.log(`        pedidos com título ativo que a leitura antiga perdia: ${cortadosComAtivo.slice(0, 10).join(", ") || "(nenhum hoje)"}`);
  checar("a leitura antiga de fato cortava (linhas < total)", (antigaProvider.data ?? []).length < direta.length, direta.length > 1000);
  checar("há pedido cortado com título ativo (a prova não é vazia)", cortadosComAtivo.length > 0, true);
  checar("pedido cortado passa a ter o aviso de título ativo", cortadosComAtivo.every((id) => novoConjunto.ativos.has(id)), true);
  checar("nenhum pedido perde o aviso", [...antigoConjunto.ativos].filter((id) => !novoConjunto.ativos.has(id)), []);

  // 3 e 4. Contas a Receber.
  const cr = await getContasReceberReadOnlyData();
  const idsCR = cr.recebiveis.map((r) => String(r.id));
  const linhasCR = await lerTodas<Record<string, unknown> & { id: string }>(() => db.from("boletos").select(CONTAS_RECEBER_SELECT), { chave: "id" });
  checar("CR: leitura do serviço completa", linhasCR.completo, true);
  // O serviço tira os A_RECEBER do mapeamento; a comparação usa os mesmos ids do mapeador.
  const { mapSupabaseBoletoRowToRecebimentoOperacional } = await import("../../src/features/contas-a-receber/mappers.ts");
  const esperadosCR = linhasCR.data
    .map((l) => mapSupabaseBoletoRowToRecebimentoOperacional(l as never))
    .filter((r) => r.status !== "A_RECEBER");
  checar("CR: mesmos títulos da leitura direta", [...idsCR].sort(), esperadosCR.map((r) => String(r.id)).sort());
  const soma = (xs: Array<{ valor?: unknown }>) => Math.round(xs.reduce((s, x) => s + (Number(x.valor) || 0), 0) * 100);
  checar("CR: soma dos valores igual à leitura direta (centavos)", soma(cr.recebiveis), soma(esperadosCR));
  const maisAntigos = direta.slice(0, 5).map((l) => l.id);
  const antigosQueEntram = maisAntigos.filter((id) => esperadosCR.some((r) => String(r.id) === id));
  checar("há boleto antigo que conta no CR (a prova não é vazia)", antigosQueEntram.length > 0, true);
  checar("CR: os boletos mais antigos entram", antigosQueEntram.every((id) => idsCR.includes(id)), true);
  checar("CR: nenhum título da leitura antiga sai", [...idsAntigosCR].filter((id) => esperadosCR.some((r) => String(r.id) === id) && !idsCR.includes(id)), []);
  const novosCR = idsCR.filter((id) => !idsAntigosCR.has(id));
  // Leitura antiga COMPLETA (as colunas da tela), mapeada pelo mesmo mapeador: nenhuma linha já vista muda,
  // e a soma nova = soma antiga + soma dos antes cortados.
  const antigaCompleta = await db.from("boletos").select(CONTAS_RECEBER_SELECT).order("created_at", { ascending: false }).limit(5000);
  const antigosMapeados = ((antigaCompleta.data ?? []) as never[]).map((l) => mapSupabaseBoletoRowToRecebimentoOperacional(l)).filter((r) => r.status !== "A_RECEBER");
  const novoPorId = new Map(cr.recebiveis.map((r) => [String(r.id), JSON.stringify(r)]));
  checar("CR: nenhuma linha já vista muda", antigosMapeados.filter((r) => novoPorId.get(String(r.id)) !== JSON.stringify(r)).map((r) => r.id), []);
  const soEntraram = cr.recebiveis.filter((r) => !idsAntigosCR.has(String(r.id)));
  checar("CR: soma nova = soma antiga + antes cortados", soma(cr.recebiveis), soma(antigosMapeados) + soma(soEntraram));
  console.log(`        CR: ${soEntraram.length} título(s) entram, R$ ${(soma(soEntraram) / 100).toFixed(2)}`);
  const cortadosAntes = direta.map((l) => l.id).filter((id) => !idsAntigosCR.has(id));
  checar("CR: só entram os antes cortados", novosCR.every((id) => cortadosAntes.includes(id)), true);
  const datas = cr.recebiveis.map((r) => String((r as { created_at?: string }).created_at ?? ""));
  checar("CR: created_at decrescente", datas.every((d, i) => i === 0 || !d || !datas[i - 1] || datas[i - 1] >= d), true);

  // 5. Duas leituras seguidas.
  const nova2 = await leituraNova();
  checar("Provider: duas leituras seguidas iguais", nova2.data.map((l) => l.id).join(), nova.data.map((l) => l.id).join());
  const cr2 = await getContasReceberReadOnlyData();
  checar("CR: duas leituras seguidas iguais", cr2.recebiveis.map((r) => String(r.id)).join(), idsCR.join());
}

console.log(falhas === 0 ? "\ntudo certo" : `\n${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
