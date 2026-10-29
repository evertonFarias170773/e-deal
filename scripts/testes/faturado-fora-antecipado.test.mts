/**
 * "Nota emitida no sistema antigo" antes do pagamento (NOVO/AGUARDANDO).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/faturado-fora-antecipado.test.mts
 *
 * A. lib: status aceitos, número da nota, mensagem.
 * B. dados reais, SO LEITURA, toda escrita barrada no fetch:
 *    - um pedido real em AGUARDANDO, com a marca SIMULADA na resposta lida
 *      (nada se grava), e recusado pela conferencia do Faturar;
 *    - o mesmo pedido sem a marca nao e recusado por ela;
 *    - a consulta da Fila exclui todo pedido marcado (pedidos marcados reais).
 */
import { config as carregarEnv } from "dotenv";
import {
  MENSAGEM_PEDIDO_FATURADO_FORA,
  normalizarNumeroNotaAntiga,
  podeMarcarNotaAntecipada
} from "../../src/features/fiscal/lib/faturado-fora.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

// ── A ──
checar("NOVO aceita", podeMarcarNotaAntecipada("NOVO"), true);
checar("AGUARDANDO aceita", podeMarcarNotaAntecipada(" aguardando "), true);
checar("EM PRODUCAO nao (la e pela Fila)", podeMarcarNotaAntecipada("EM PRODUCAO"), false);
checar("numero valido", normalizarNumeroNotaAntiga("004512"), "4512");
checar("numero vazio recusa", normalizarNumeroNotaAntiga(""), null);
checar("numero zero recusa", normalizarNumeroNotaAntiga("000"), null);
checar("numero com letra recusa", normalizarNumeroNotaAntiga("12a"), null);
checar("numero com 10 digitos recusa", normalizarNumeroNotaAntiga("1234567890"), null);
checar("mensagem", MENSAGEM_PEDIDO_FATURADO_FORA, "Este pedido já tem nota emitida no sistema antigo.");

// ── B ──
carregarEnv({ path: ".env.local", quiet: true });
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(parte B pulada: .env.local sem chaves)");
} else {
  const fetchOriginal = globalThis.fetch;
  let escritas = 0;
  /** id_int cuja leitura de `propostas` volta com a marca simulada. */
  let simularMarcaEm: number | null = null;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
      escritas += 1;
      throw new Error("escrita barrada no teste");
    }
    const resposta = await fetchOriginal(entrada, init);
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (simularMarcaEm !== null && url.includes("/rest/v1/propostas?") && url.includes(`id_int=eq.${simularMarcaEm}`)) {
      const corpo = await resposta.json();
      const marcar = (linha: Record<string, unknown>) => ({
        ...linha,
        faturado_fora_em: "2026-10-29T12:00:00.000Z",
        faturado_fora_por: "teste@simulado"
      });
      const novo = Array.isArray(corpo) ? corpo.map(marcar) : marcar(corpo);
      return new Response(JSON.stringify(novo), { status: resposta.status, headers: resposta.headers });
    }
    return resposta;
  }) as typeof fetch;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

  const { conferirFaturamento } = await import("../../src/features/fiscal/services/conferencia-faturamento.ts");
  const { getFaturaveisPropostas } = await import("../../src/features/nfe/services/nfe.service.ts");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

  const { data: aguardando } = await sb
    .from("propostas")
    .select("id_int,faturado_fora_em,libera_nf")
    .eq("status_interno", "AGUARDANDO")
    .is("faturado_fora_em", null)
    .order("id_int", { ascending: false })
    .limit(1);
  const pedido = (aguardando ?? [])[0] as { id_int: number } | undefined;
  if (!pedido) {
    console.log("(sem pedido em AGUARDANDO sem marca para a prova)");
  } else {
    console.log(`pedido de prova: #${pedido.id_int} (AGUARDANDO, marca simulada so na leitura)`);
    simularMarcaEm = pedido.id_int;
    const comMarca = await conferirFaturamento(pedido.id_int);
    checar("marcado: conferencia recusa", comMarca.ok, false);
    checar(
      "marcado: um bloqueio so, com a mensagem",
      comMarca.bloqueios.map((b) => [b.codigo, b.titulo]),
      [["FATURADO_NO_SISTEMA_ANTIGO", MENSAGEM_PEDIDO_FATURADO_FORA]]
    );
    checar("marcado: sem botao Abrir para corrigir", comMarca.bloqueios[0]?.rota, undefined);

    simularMarcaEm = null;
    const semMarca = await conferirFaturamento(pedido.id_int);
    checar(
      "sem marca: nao ha esse bloqueio",
      semMarca.bloqueios.some((b) => b.codigo === "FATURADO_NO_SISTEMA_ANTIGO"),
      false
    );
  }

  // Fila: nenhum pedido marcado (real) aparece, nem os que tem libera_nf ligada.
  const { data: marcados } = await sb.from("propostas").select("id_int,libera_nf").not("faturado_fora_em", "is", null);
  const marcadosIds = new Set((marcados ?? []).map((m) => Number((m as { id_int: number }).id_int)));
  const comLibera = (marcados ?? []).filter((m) => (m as { libera_nf: boolean }).libera_nf).length;
  const fila = await getFaturaveisPropostas();
  console.log(`pedidos marcados: ${marcadosIds.size} (com libera_nf ligada: ${comLibera}); fila: ${fila.length}`);
  checar("nenhum pedido marcado na Fila", fila.filter((f) => marcadosIds.has(Number(f.id_int))).length, 0);
  checar("nada foi gravado", escritas, 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exitCode = falhas ? 1 : 0;
