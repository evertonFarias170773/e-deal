/**
 * A fila fiscal nao lista pedido encerrado como TESTE.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/fila-sem-pedido-de-teste.test.mts
 *
 * Roda o `getFaturaveisPropostas` de verdade e aplica o mesmo recorte padrao da
 * tela (pedido com nota viva nao aparece). Somente leitura: qualquer escrita e
 * barrada e faria o teste falhar.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const escritas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    escritas.push(metodo);
    throw new Error("escrita barrada no teste");
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `  (esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)})`}`);
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { getFaturaveisPropostas } = await import("../../src/features/nfe/services/nfe.service.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

const base = await getFaturaveisPropostas();
// O recorte padrao da tela: pedido com nota viva sai da lista.
const visiveis = base.filter((item) => (item.notas_vivas ?? 0) === 0);
const ids = visiveis.map((item) => Number(item.id_int)).sort((a, b) => a - b);

console.log(`fila (base): ${base.length} | visiveis: ${visiveis.length}`);
console.log(`pedidos visiveis: ${ids.join(", ")}`);

// Quem, entre os que vieram, tem a marca de teste.
const todosIds = base.map((item) => Number(item.id_int)).filter((id) => Number.isFinite(id) && id > 0);
const { data: marcados } = await sb
  .from("propostas").select("id_int").in("id_int", todosIds.length ? todosIds : [-1])
  .not("encerrado_teste_em", "is", null);
const comMarca = (marcados ?? []).map((l) => Number((l as { id_int: number }).id_int)).sort((a, b) => a - b);
console.log(`com marca de teste entre os que vieram: ${comMarca.length ? comMarca.join(", ") : "(nenhum)"}`);

checar("nenhum pedido encerrado como teste chega a fila", comMarca, []);
checar("o 22334 nao esta na fila", ids.includes(22334), false);
checar("o contador da aba e o tamanho da lista sao o mesmo numero", visiveis.length, ids.length);
checar("a fila continua com pedidos reais", visiveis.length > 0, true);
checar("nenhuma escrita tentada", escritas.length, 0);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
