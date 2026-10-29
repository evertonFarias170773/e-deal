/**
 * "Liberar nota antecipada": pedido em AGUARDANDO entra na Fila de Faturamento.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nota-antecipada.test.mts
 *
 * A. regra (pura).
 * B. dados reais, SO LEITURA. Toda escrita e barrada no fetch e registrada:
 *    - um pedido real em AGUARDANDO, com `libera_nf` SIMULADA: a consulta da Fila
 *      e refeita pelo banco com os MESMOS filtros, trocando so `libera_nf=eq.true`
 *      pelo id do pedido (e de um pedido marcado do sistema antigo, que o proprio
 *      banco tem de cortar);
 *    - a conferencia do Faturar desse pedido (o que falta);
 *    - o servico de gravacao chega a escrita com SO `libera_nf`, e ela e barrada.
 */
import { config as carregarEnv } from "dotenv";
import {
  decidirDesfazerNotaAntecipada,
  decidirLiberarNotaAntecipada,
  podeVerLiberarNotaAntecipada
} from "../../src/features/orcamentos/lib/nota-antecipada.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}
const acao = (d: { acao: string; code?: string }) => (d.acao === "recusar" ? `recusar:${d.code}` : d.acao);
const base = { statusInterno: "AGUARDANDO", liberaNf: false, isPrdAprovado: false, faturadoForaEm: null };

// ── A ──
checar("AGUARDANDO limpo: libera", acao(decidirLiberarNotaAntecipada(base, [])), "gravar");
checar("NOVO: recusa", acao(decidirLiberarNotaAntecipada({ ...base, statusInterno: "NOVO" }, [])), "recusar:FORA_DE_AGUARDANDO");
checar("REVISAO ATENDENTE: recusa", acao(decidirLiberarNotaAntecipada({ ...base, statusInterno: "REVISAO ATENDENTE" }, [])), "recusar:FORA_DE_AGUARDANDO");
checar("na producao: recusa", acao(decidirLiberarNotaAntecipada({ ...base, isPrdAprovado: true }, [])), "recusar:JA_NA_PRODUCAO");
checar("sistema antigo: recusa", acao(decidirLiberarNotaAntecipada({ ...base, faturadoForaEm: "2026-10-29" }, [])), "recusar:FATURADO_NO_SISTEMA_ANTIGO");
checar("ja liberado: idempotente", acao(decidirLiberarNotaAntecipada({ ...base, liberaNf: true }, [])), "idempotente");
checar(
  "NF-e de venda autorizada: recusa",
  acao(decidirLiberarNotaAntecipada(base, [{ ref: "NFE-1-001", status: "AUTORIZADA", tipoNota: null }])),
  "recusar:TEM_NOTA_DE_VENDA"
);
checar(
  "NF-e em processamento: recusa",
  acao(decidirLiberarNotaAntecipada(base, [{ ref: "NFE-1-001", status: "PROCESSANDO", tipoNota: null }])),
  "recusar:TEM_NOTA_DE_VENDA"
);
checar(
  "so cancelada ou remessa: libera",
  acao(decidirLiberarNotaAntecipada(base, [
    { ref: "NFE-1-001", status: "CANCELADA", tipoNota: null },
    { ref: "NFE-1-002", status: "AUTORIZADA", tipoNota: "REMESSA" }
  ])),
  "gravar"
);
const liberado = { ...base, liberaNf: true };
checar("desfazer sem nota: desfaz", acao(decidirDesfazerNotaAntecipada(liberado, [])), "gravar");
checar(
  "desfazer com rascunho: recusa",
  acao(decidirDesfazerNotaAntecipada(liberado, [{ ref: "NFE-1-001", status: "PENDENTE", tipoNota: null }])),
  "recusar:TEM_NOTA_DE_VENDA"
);
checar("desfazer depois do pagamento (REVISAO ATENDENTE): recusa", acao(decidirDesfazerNotaAntecipada({ ...liberado, statusInterno: "REVISAO ATENDENTE" }, [])), "recusar:FORA_DE_AGUARDANDO");
checar("desfazer sem libera_nf: idempotente", acao(decidirDesfazerNotaAntecipada(base, [])), "idempotente");
checar("menu: sem permissao nao ve", podeVerLiberarNotaAntecipada(false, base), false);
checar("menu: com permissao ve", podeVerLiberarNotaAntecipada(true, base), true);

// ── B ──
carregarEnv({ path: ".env.local", quiet: true });
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(parte B pulada: .env.local sem chaves)");
} else {
  const fetchOriginal = globalThis.fetch;
  const escritas: Array<{ metodo: string; url: string; corpo: unknown }> = [];
  /** Ids que a consulta da Fila deve trazer como se tivessem `libera_nf` ligada. */
  let simularLiberaNfEm: number[] | null = null;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
      let corpo: unknown = init?.body ?? null;
      try { corpo = JSON.parse(String(init?.body ?? "null")); } catch { /* cru */ }
      escritas.push({ metodo, url: decodeURIComponent(url), corpo });
      throw new Error("escrita barrada no teste");
    }
    if (simularLiberaNfEm && url.includes("/rest/v1/propostas?") && url.includes("libera_nf=eq.true")) {
      // Mesma consulta, mesmos filtros do banco; so a porta `libera_nf` vira os ids.
      const trocada = url.replace("libera_nf=eq.true", `id_int=in.(${simularLiberaNfEm.join(",")})`);
      return fetchOriginal(trocada, init);
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

  const { getFaturaveisPropostas } = await import("../../src/features/nfe/services/nfe.service.ts");
  const { conferirFaturamento } = await import("../../src/features/fiscal/services/conferencia-faturamento.ts");
  const { gravarNotaAntecipada } = await import("../../src/features/orcamentos/services/nota-antecipada.server.ts");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

  // Pedido real em AGUARDANDO, sem libera_nf, sem marca, de cliente que recebe nota.
  const { data: candidatos } = await sb
    .from("propostas")
    .select("id_int,id_cliente,libera_nf,is_prd_aprovado,faturado_fora_em,valor_total")
    .eq("status_interno", "AGUARDANDO")
    .or("libera_nf.is.null,libera_nf.eq.false")
    .is("faturado_fora_em", null)
    .is("encerrado_teste_em", null)
    .order("id_int", { ascending: false })
    .limit(20);
  const { data: semNota } = await sb.from("clientes").select("id_cliente").eq("nota", false);
  const naoRecebe = new Set((semNota ?? []).map((c) => Number((c as { id_cliente: number }).id_cliente)));
  const pedido = (candidatos ?? []).find((c) => !naoRecebe.has(Number((c as { id_cliente: number }).id_cliente))) as
    | { id_int: number; valor_total: number }
    | undefined;
  const { data: marcados } = await sb.from("propostas").select("id_int").not("faturado_fora_em", "is", null).limit(1);
  const marcado = Number((marcados ?? [])[0]?.id_int);

  if (!pedido) {
    console.log("(sem pedido em AGUARDANDO elegivel para a prova)");
  } else {
    console.log(`pedido de prova: #${pedido.id_int} (AGUARDANDO, valor ${pedido.valor_total}); marcado do sistema antigo: #${marcado}`);

    simularLiberaNfEm = null;
    const filaReal = await getFaturaveisPropostas();
    checar("hoje (sem libera_nf): fora da Fila", filaReal.some((f) => Number(f.id_int) === pedido.id_int), false);

    simularLiberaNfEm = [pedido.id_int, marcado];
    const filaSimulada = await getFaturaveisPropostas();
    simularLiberaNfEm = null;
    checar("libera_nf simulada: entra na Fila", filaSimulada.some((f) => Number(f.id_int) === pedido.id_int), true);
    checar("marcado do sistema antigo: continua fora", filaSimulada.some((f) => Number(f.id_int) === marcado), false);
    const linha = filaSimulada.find((f) => Number(f.id_int) === pedido.id_int);
    console.log(`  na Fila: status ${linha?.status_interno}, cobranca ${linha?.tipo_cobranca ?? "nenhuma"}, notas vivas ${linha?.notas_vivas}`);

    const conf = await conferirFaturamento(pedido.id_int);
    console.log(`  conferencia: ok=${conf.ok}`);
    for (const b of conf.bloqueios) console.log(`    BLOQUEIO ${b.codigo}: ${b.titulo}`);
    for (const a of conf.avisos) console.log(`    aviso ${a.codigo}: ${a.titulo}`);
    checar("conferencia nao barra por status nem por pagamento", conf.bloqueios.some((b) => /PAGAMENTO|STATUS/.test(b.codigo)), false);

    const confMarcado = await conferirFaturamento(marcado);
    checar("marcado: Faturar recusa", confMarcado.bloqueios.map((b) => b.codigo), ["FATURADO_NO_SISTEMA_ANTIGO"]);

    // Servico de gravacao: chega a escrita com SO libera_nf, guardada pelo estado lido.
    escritas.length = 0;
    const resultado = await gravarNotaAntecipada(sb as never, {
      idInt: pedido.id_int,
      liberar: true,
      autor: { uid: "teste", nome: "Teste", email: null }
    });
    checar(
      "gravacao: a escrita foi barrada e o servico diz que nada foi gravado",
      [resultado.success, (resultado as { code?: string }).code],
      [false, "NAO_GRAVADO"]
    );
    checar("gravacao: uma escrita so, PATCH em propostas", escritas.map((e) => `${e.metodo} ${e.url.split("?")[0].split("/rest/v1/")[1]}`), ["PATCH propostas"]);
    checar("gravacao: corpo e so libera_nf", escritas[0]?.corpo, { libera_nf: true });
    const filtros = escritas[0]?.url.split("?")[1] ?? "";
    checar(
      "gravacao: guardada por status, libera_nf, producao e sistema antigo",
      ["status_interno=eq.AGUARDANDO", "faturado_fora_em=is.null", "is_prd_aprovado="].every((f) => filtros.includes(f)) && /libera_nf=(is\.null|eq\.false)/.test(filtros),
      true
    );
  }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exitCode = falhas ? 1 : 0;
