/**
 * "Abrir para corrigir" do modal da conferencia (Notas fiscais): ida para a
 * EDICAO do cadastro certo, no campo pendente, e volta para reconferir.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/correcao-de-cadastro.test.mts
 *
 * Parte A: a lib (pura). Parte B: a conferencia real, so leitura, com toda
 * escrita barrada no fetch.
 */
import { config as carregarEnv } from "dotenv";
import {
  lerCorrecaoDaUrl,
  lerPedidoParaReconferir,
  rotaDeCorrecaoDoCadastro,
  rotaDeVoltaParaReconferir
} from "../../src/lib/fiscal/correcao-de-cadastro.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

// ── A. lib ──
checar(
  "ida: edicao do cadastro com foco e pedido",
  rotaDeCorrecaoDoCadastro(959608, "tipo_contribuinte", 24421),
  "/cadastros/959608/editar?foco=tipo_contribuinte&reconferir=24421"
);
checar("volta: notas fiscais com reconferir", rotaDeVoltaParaReconferir(24421), "/notas-fiscais?reconferir=24421");
checar(
  "le foco e pedido validos",
  lerCorrecaoDaUrl(new URLSearchParams("foco=inscricao_estadual&reconferir=24421")),
  { foco: "inscricao_estadual", pedido: 24421 }
);
checar(
  "foco fora da lista e pedido invalido sao ignorados",
  lerCorrecaoDaUrl(new URLSearchParams("foco=limite_credito&reconferir=24421abc")),
  { foco: null, pedido: null }
);
checar("sem parametros", lerCorrecaoDaUrl(new URLSearchParams("")), { foco: null, pedido: null });
checar("pedido zero ou negativo nao vale", lerPedidoParaReconferir(new URLSearchParams("reconferir=0")), null);
checar("pedido com url embutida nao vale", lerPedidoParaReconferir(new URLSearchParams("reconferir=//x.com")), null);
checar("pedido valido", lerPedidoParaReconferir(new URLSearchParams("reconferir=24421")), 24421);

// ── B. conferencia real, so leitura ──
carregarEnv({ path: ".env.local", quiet: true });
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(parte B pulada: .env.local sem chaves)");
} else {
  const fetchOriginal = globalThis.fetch;
  let escritas = 0;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
      escritas += 1;
      throw new Error("escrita barrada no teste");
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

  const { conferirFaturamento } = await import("../../src/features/fiscal/services/conferencia-faturamento.ts");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

  // 24421: cliente 66568, pagador 959608 (terceiro).
  const { data: p } = await sb.from("propostas").select("id_cliente,id_faturado").eq("id_int", 24421).maybeSingle();
  const r = await conferirFaturamento(24421);
  const tipo = r.bloqueios.find((b) => b.codigo === "TIPO_CONTRIBUINTE_INDEFINIDO");
  if (!tipo) {
    console.log("(24421 nao tem mais a pendencia de tipo de contribuinte: o dado vivo mudou)");
  } else {
    checar(
      "24421: botao vai a edicao do PAGADOR, no tipo de contribuinte",
      tipo.rota,
      `/cadastros/${p?.id_faturado}/editar?foco=tipo_contribuinte&reconferir=24421`
    );
    checar("24421: o destino nao e o cliente do pedido", tipo.rota?.includes(`/cadastros/${p?.id_cliente}/`), false);
  }

  // Nenhuma pendencia de cadastro aponta para a ficha so de leitura.
  const todas = [...r.bloqueios, ...r.avisos];
  checar(
    "24421: nenhuma rota de cadastro cai na ficha de leitura",
    todas.filter((b) => /^\/cadastros\/\d+$/.test(b.rota ?? "")).map((b) => b.codigo),
    []
  );
  checar("conferencia nao tentou gravar nada", escritas, 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exitCode = falhas ? 1 : 0;
