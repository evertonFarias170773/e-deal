/**
 * Despachar de novo MOTOBOY/TRANSPORTADORA em EXPEDICAO: novo ciclo de coleta (pedido 23604).
 *
 *   node --experimental-strip-types scripts/testes/despachar-novo-ciclo-coleta.test.mts
 *
 * SEM banco: cliente Supabase falso (so anota o que `despachar()` grava). Quatro casos:
 *   1. primeiro despacho (igual a antes: sem `coletado_em` no upsert, ou null por cima de null)
 *   2. despacho repetido com `coletado_em` antigo em EXPEDICAO (coleta limpa, aguardandoColeta verdadeiro)
 *   3. pedido EM TRANSITO (coleta preservada)
 *   4. Correios (igual a antes)
 */
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
const arquivo = (base: string) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`].find((c) => existsSync(c) && statSync(c).isFile());
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@/lib/supabase/client") return { url: url("_supabase-falso.mts"), shortCircuit: true };
    if (especificador.startsWith("@/")) {
      const f = arquivo(path.join(RAIZ, "src", especificador.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (especificador.startsWith(".") && contexto.parentURL?.startsWith("file:")) {
      const f = arquivo(path.resolve(path.dirname(fileURLToPath(contexto.parentURL)), especificador));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const { despachar } = await import("../../src/features/expedicao/services/expedicao-acoes.service.ts");
const { deveLimparColetaNoDespacho } = await import("../../src/features/expedicao/lib/destino-despacho.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const ator = { uid: "u-1", nome: "Edina Farias" };
const base = {
  tipoEntrega: "TRANSPORTE" as const,
  modalidadeFrete: "CIF" as const,
  transportadoraNome: "",
  idTransportadoraCliente: null,
  pesoKg: 1.2,
  qtdVolumes: 1,
  tipoVolume: "Pacote",
  idEnderecoEntrega: "end-1",
  codigoRastreamento: "EDUARDA BAZOTTI"
};

type Cenario = { status: string; coletadoAntigo: boolean };
async function roda(tipoFrete: "MOTOBOY" | "TRANSPORTADORA" | "CORREIOS", c: Cenario) {
  falso.zerar();
  // Ordem das leituras de `propostas` em despachar(): propAtual; complementos abertos (lista); estado do
  // conhecimento; e, por fim, listas vazias (complementos ja despachados etc.).
  falso.responderEmSequencia("propostas:select", [
    { data: { status_interno: c.status, valor_frete: 38.38, id_int_pedido_principal: null, valor_total: 398.47 }, error: null },
    { data: [], error: null },
    { data: { status_interno: c.status }, error: null },
    { data: [], error: null }
  ]);
  falso.responder("expedicoes:select", {
    data: { codigo_rastreamento: null, tipo_frete: tipoFrete, coletado_em: c.coletadoAntigo ? "2026-10-19T18:02:07.345+00:00" : null },
    error: null
  });
  falso.responder("expedicoes:upsert", { data: null, error: null });
  falso.responder("propostas:update", { data: [{ id_int: 23604 }], error: null });
  const res = await despachar(23604, { ...base, tipoFrete, transportadoraNome: tipoFrete === "MOTOBOY" ? "Motoboy" : tipoFrete === "TRANSPORTADORA" ? "Transp X" : "Correios" }, ator);
  const up = falso.chamadas.find((x) => x.tabela === "expedicoes" && x.op === "upsert");
  const payload = (up?.payload ?? {}) as Record<string, unknown>;
  const transicoes = falso.chamadas.filter((x) => x.tabela === "propostas" && x.op === "update");
  return { res, payload, transicoes };
}

// ── a regra pura
confere("regra: motoboy em EXPEDICAO limpa", deveLimparColetaNoDespacho({ tipoEntrega: "TRANSPORTE", tipoFrete: "MOTOBOY", statusAtual: "EXPEDICAO" }));
confere("regra: transportadora em EXPEDICAO limpa", deveLimparColetaNoDespacho({ tipoEntrega: "TRANSPORTE", tipoFrete: "TRANSPORTADORA", statusAtual: "EXPEDICAO" }));
confere("regra: EM TRANSITO nao limpa", !deveLimparColetaNoDespacho({ tipoEntrega: "TRANSPORTE", tipoFrete: "MOTOBOY", statusAtual: "EM TRANSITO" }));
confere("regra: ENTREGUE e status vazio nao limpam", !deveLimparColetaNoDespacho({ tipoEntrega: "TRANSPORTE", tipoFrete: "MOTOBOY", statusAtual: "ENTREGUE" }) && !deveLimparColetaNoDespacho({ tipoEntrega: "TRANSPORTE", tipoFrete: "MOTOBOY", statusAtual: null }));
confere("regra: Correios e retirada nao limpam", !deveLimparColetaNoDespacho({ tipoEntrega: "TRANSPORTE", tipoFrete: "CORREIOS", statusAtual: "EXPEDICAO" }) && !deveLimparColetaNoDespacho({ tipoEntrega: "RETIRADA", tipoFrete: "RETIRA_BALCAO", statusAtual: "EXPEDICAO" }));

// ── 1. primeiro despacho (coleta ja vazia): grava o mesmo que antes
{
  const { res, payload, transicoes } = await roda("MOTOBOY", { status: "EXPEDICAO", coletadoAntigo: false });
  confere("1. primeiro despacho: sucesso", res.success === true, res);
  confere("1. primeiro despacho: coletado_em NAO entra na gravacao (payload igual ao de antes)", !("coletado_em" in payload), payload);
  confere("1. primeiro despacho: data_despacho e despachado_por gravados", typeof payload.data_despacho === "string" && payload.despachado_por === "Edina Farias");
  confere("1. primeiro despacho: sem transicao de status (aguardando coleta)", transicoes.length === 0 && res.aguardandoColeta === true, { transicoes: transicoes.length, ag: res.aguardandoColeta });
}

// ── 2. despacho repetido com coleta antiga, em EXPEDICAO: coleta limpa na MESMA gravacao
{
  const { res, payload, transicoes } = await roda("MOTOBOY", { status: "EXPEDICAO", coletadoAntigo: true });
  confere("2. repetido em EXPEDICAO: sucesso", res.success === true, res);
  confere("2. coletado_em = null na MESMA gravacao do despacho", payload.coletado_em === null && "coletado_em" in payload && typeof payload.data_despacho === "string" && payload.despachado_por === "Edina Farias", payload);
  confere("2. aguardandoColeta verdadeiro (despacho novo + coleta limpa + sem transicao)", res.aguardandoColeta === true && transicoes.length === 0, { ag: res.aguardandoColeta, t: transicoes.length });
  // O que o painel calcula a partir do registro resultante (expedicao.service): despacho + coleta vazia + EXPEDICAO.
  const aguardandoColetaDoPainel = Boolean(payload.data_despacho) && !payload.coletado_em;
  confere("2. a leitura do painel (despacho && !coletadoEm) fica verdadeira", aguardandoColetaDoPainel);
}
{
  const { payload } = await roda("TRANSPORTADORA", { status: "EXPEDICAO", coletadoAntigo: true });
  confere("2b. transportadora: coletado_em = null", payload.coletado_em === null && "coletado_em" in payload, payload);
}

// ── 3. pedido EM TRANSITO (aba velha): a coleta valida e preservada
{
  const { payload } = await roda("MOTOBOY", { status: "EM TRANSITO", coletadoAntigo: true });
  confere("3. EM TRANSITO: coletado_em NAO entra no upsert (coleta preservada)", !("coletado_em" in payload), payload);
}
{
  const { payload } = await roda("MOTOBOY", { status: "ENTREGUE", coletadoAntigo: true });
  confere("3b. ENTREGUE: coletado_em preservado", !("coletado_em" in payload), payload);
}

// ── 4. Correios: igual a antes (a postagem e a coleta; transicao para EM TRANSITO como sempre)
{
  const { res, payload, transicoes } = await roda("CORREIOS", { status: "EXPEDICAO", coletadoAntigo: true });
  confere("4. Correios: sucesso", res.success === true, res);
  confere("4. Correios: coletado_em NAO e tocado", !("coletado_em" in payload), payload);
  confere("4. Correios: transiciona para EM TRANSITO como sempre", transicoes.length === 1 && (transicoes[0].payload as { status_interno?: string })?.status_interno === "EM TRANSITO", transicoes.map((t) => t.payload));
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
