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

// ═══════════════ COMPLEMENTO (23605, complemento do 23604) ═══════════════
// Despacho CONJUNTO: o principal sai e leva o complemento em EXPEDICAO. O upsert do complemento e proprio.
type CenCompl = { statusDoComplemento: string; coletaDoComplemento: boolean };
async function rodaConjunto(tipoFrete: "MOTOBOY" | "TRANSPORTADORA" | "CORREIOS", c: CenCompl) {
  falso.zerar();
  falso.responderEmSequencia("propostas:select", [
    { data: { status_interno: "EXPEDICAO", valor_frete: 38.38, id_int_pedido_principal: null, valor_total: 398.47 }, error: null },
    { data: [{ id_int: 23605, status_interno: "EXPEDICAO", valor_total: 100 }], error: null }, // complementos abertos (lista)
    { data: { status_interno: "EXPEDICAO" }, error: null }, // estado do conhecimento
    { data: [{ id_int: 23605, status_interno: c.statusDoComplemento }], error: null }, // complementos em EXPEDICAO (conjunto)
    { data: [], error: null }
  ]);
  falso.responderEmSequencia("expedicoes:select", [
    { data: { codigo_rastreamento: null, tipo_frete: tipoFrete, coletado_em: null }, error: null }, // estado do principal
    { data: [{ id_int: 23605, coletado_em: c.coletaDoComplemento ? "2026-10-19T18:02:07.345+00:00" : null }], error: null }, // coleta dos complementos
    { data: [], error: null }
  ]);
  falso.responder("rpc:cc__valor_pago", { data: 100, error: null });
  falso.responder("expedicoes:upsert", { data: null, error: null });
  falso.responder("propostas:update", { data: [{ id_int: 23605 }], error: null });
  const res = await despachar(23604, { ...base, tipoFrete, transportadoraNome: tipoFrete === "MOTOBOY" ? "Motoboy" : tipoFrete === "TRANSPORTADORA" ? "Transp X" : "Correios" }, ator);
  const upCompl = falso.chamadas.find((x) => x.tabela === "expedicoes" && x.op === "upsert" && (x.payload as { id_int?: number })?.id_int === 23605);
  const lerColetas = falso.chamadas.filter((x) => x.tabela === "expedicoes" && x.op === "select").length;
  return { res, payload: (upCompl?.payload ?? null) as Record<string, unknown> | null, lerColetas };
}

{
  const { res, payload } = await rodaConjunto("MOTOBOY", { statusDoComplemento: "EXPEDICAO", coletaDoComplemento: false });
  confere("C1. conjunto, 1o despacho do complemento: saiu junto", Array.isArray(res.complementosDespachados) && res.complementosDespachados.includes(23605) && payload !== null, res);
  confere("C1. payload do complemento igual ao de antes (sem coletado_em)", payload !== null && !("coletado_em" in payload), payload);
}
{
  const { payload, res } = await rodaConjunto("MOTOBOY", { statusDoComplemento: "EXPEDICAO", coletaDoComplemento: true });
  confere("C2. conjunto, repetido em EXPEDICAO com coleta antiga: coletado_em = null junto com data_despacho/despachado_por", payload !== null && payload.coletado_em === null && "coletado_em" in payload && typeof payload.data_despacho === "string" && payload.despachado_por === "Edina Farias", payload);
  confere("C2. aguardandoColeta verdadeiro (sem transicao do principal nem do complemento)", res.aguardandoColeta === true && falso.chamadas.filter((x) => x.tabela === "propostas" && x.op === "update").length === 0);
}
{
  const { payload } = await rodaConjunto("TRANSPORTADORA", { statusDoComplemento: "EXPEDICAO", coletaDoComplemento: true });
  confere("C2b. transportadora: coleta do complemento limpa", payload !== null && payload.coletado_em === null && "coletado_em" in payload, payload);
}
for (const status of ["EM TRANSITO", "ENTREGUE"]) {
  const { payload } = await rodaConjunto("MOTOBOY", { statusDoComplemento: status, coletaDoComplemento: true });
  confere(`C3. complemento ${status} (status proprio, lido do banco): coleta preservada`, payload !== null && !("coletado_em" in payload), payload);
}
{
  const { res, payload, lerColetas } = await rodaConjunto("CORREIOS", { statusDoComplemento: "EXPEDICAO", coletaDoComplemento: true });
  confere("C4. Correios: complemento sai junto e coletado_em NAO e tocado", Array.isArray(res.complementosDespachados) && payload !== null && !("coletado_em" in payload), payload);
  confere("C4. Correios: nenhuma leitura extra de coleta (so a do estado do principal)", lerColetas === 1, lerColetas);
}

// Caminho de REPETICAO: o proprio complemento clicado depois que o principal ja saiu.
async function rodaRepeticao(statusDoComplemento: string, coletaDoComplemento: boolean, tipoPrincipal: "MOTOBOY" | "CORREIOS") {
  falso.zerar();
  falso.responderEmSequencia("propostas:select", [
    { data: { status_interno: statusDoComplemento, valor_frete: 0, id_int_pedido_principal: 23604, valor_total: 100 }, error: null },
    { data: [], error: null }
  ]);
  falso.responderEmSequencia("expedicoes:select", [
    { data: { data_despacho: "2026-10-20T11:29:32.02+00:00", modalidade_frete: "CIF", tipo_frete: tipoPrincipal, transportadora_nome: "Motoboy", categoria_frete: "MOTOBOY", id_transportadora_cliente: null, id_endereco_entrega: "end-1", tipo_volume: "Pacote", codigo_rastreamento: "EDUARDA BAZOTTI" }, error: null }, // do principal
    { data: { coletado_em: coletaDoComplemento ? "2026-10-19T18:02:07.345+00:00" : null }, error: null }, // do proprio complemento
    { data: [], error: null }
  ]);
  falso.responder("rpc:cc__valor_pago", { data: 100, error: null });
  falso.responder("expedicoes:upsert", { data: null, error: null });
  falso.responder("propostas:update", { data: [{ id_int: 23605 }], error: null });
  falso.responder("propostas_os:update", { data: null, error: null });
  const res = await despachar(23605, { ...base, tipoFrete: tipoPrincipal, transportadoraNome: "x" }, ator);
  const up = falso.chamadas.find((x) => x.tabela === "expedicoes" && x.op === "upsert");
  return { res, payload: (up?.payload ?? null) as Record<string, unknown> | null };
}
{
  const { res, payload } = await rodaRepeticao("EXPEDICAO", false, "MOTOBOY");
  confere("R1. repeticao, 1o despacho do complemento: igual a antes (sem coletado_em)", res.success === true && payload !== null && !("coletado_em" in payload), { res, payload });
}
{
  const { res, payload } = await rodaRepeticao("EXPEDICAO", true, "MOTOBOY");
  confere("R2. repeticao em EXPEDICAO com coleta antiga: coletado_em = null + aguardandoColeta verdadeiro", res.success === true && res.aguardandoColeta === true && payload !== null && payload.coletado_em === null && "coletado_em" in payload && typeof payload.data_despacho === "string", { res, payload });
}
{
  const { res, payload } = await rodaRepeticao("EM TRANSITO", true, "MOTOBOY");
  confere("R3. repeticao com o complemento EM TRANSITO: nada e gravado (conflito de status), coleta preservada", res.success === false && payload === null, { res, payload });
}
{
  const { res, payload } = await rodaRepeticao("EXPEDICAO", true, "CORREIOS");
  confere("R4. repeticao Correios: coletado_em NAO e tocado", res.success === true && payload !== null && !("coletado_em" in payload), { res, payload });
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
