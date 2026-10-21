/**
 * "Cliente vai retirar no balcao" (ADM, pedido CIF; lib/retirada-adm, 21/10/2026).
 *
 *   node --experimental-strip-types scripts/testes/retirada-adm.test.mts
 *
 * SEM banco: cliente Supabase falso (so anota o que `despachar()` grava).
 */
import { registerHooks } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
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
const { podeOferecerRetiradaAdm, tipoEntregaDoDespacho, retiradaAdmLiberada, MENSAGEM_RETIRADA_PRECISA_LIBERAR, MOTIVO_RETIRADA_ADM } =
  await import("../../src/features/expedicao/lib/retirada-adm.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── a regra pura
confere("ADM com CIF travado, no despacho: ve a opcao", podeOferecerRetiradaAdm({ ehAdmNoCadastro: true, modalidadeInicial: "CIF", modoEdicao: false }));
confere("nao-ADM: nao ve", !podeOferecerRetiradaAdm({ ehAdmNoCadastro: false, modalidadeInicial: "CIF", modoEdicao: false }));
confere("ADM sem CIF travado (FOB, RETIRA, nula): nao ve", ["FOB", "RETIRA", null].every((m) => !podeOferecerRetiradaAdm({ ehAdmNoCadastro: true, modalidadeInicial: m, modoEdicao: false })));
confere("ADM na edicao dos dados: nao ve", !podeOferecerRetiradaAdm({ ehAdmNoCadastro: true, modalidadeInicial: "CIF", modoEdicao: true }));
confere("tipo de entrega: RETIRA sempre retirada; CIF so com a marca; FOB nunca", [
  tipoEntregaDoDespacho("RETIRA", false), tipoEntregaDoDespacho("CIF", false), tipoEntregaDoDespacho("CIF", true), tipoEntregaDoDespacho("FOB", true)
].join() === "RETIRADA,TRANSPORTE,RETIRADA,TRANSPORTE");
confere("liberada pela trava ou por liberacao ativa; sem nenhuma, nao", [
  retiradaAdmLiberada({ situacaoDaTrava: "LIBERADO_ADM", temLiberacaoAtiva: false }),
  retiradaAdmLiberada({ situacaoDaTrava: "SEM_COTACAO", temLiberacaoAtiva: true }),
  !retiradaAdmLiberada({ situacaoDaTrava: "SEM_COTACAO", temLiberacaoAtiva: false }),
  !retiradaAdmLiberada({ situacaoDaTrava: "PRECISA_RECOTAR", temLiberacaoAtiva: false })
].every(Boolean));

// ── o despacho
const ator = { uid: "u-adm", nome: "ADM Teste" };
const transporte = {
  tipoEntrega: "TRANSPORTE" as const, modalidadeFrete: "CIF" as const, tipoFrete: "CORREIOS" as const,
  transportadoraNome: "Correios", idTransportadoraCliente: null, pesoKg: 1.2, qtdVolumes: 1, tipoVolume: "Pacote",
  idEnderecoEntrega: "end-1", codigoRastreamento: ""
};
// O que o modal manda com "Cliente vai retirar no balcao" marcado num CIF (handleConfirmar).
const retirada = { ...transporte, tipoEntrega: "RETIRADA" as const, tipoFrete: "RETIRA_BALCAO" as const, transportadoraNome: "Retira balcão", retiradaNoBalcaoAdm: true };

async function roda(input: Record<string, unknown>, trava: Record<string, unknown>, liberacoesAtivas: unknown[]) {
  falso.zerar();
  falso.responderEmSequencia("propostas:select", [
    { data: { status_interno: "EXPEDICAO", valor_frete: 12.45, id_int_pedido_principal: null, valor_total: 268.45 }, error: null },
    { data: [], error: null },
    { data: { status_interno: "EXPEDICAO" }, error: null },
    { data: [], error: null }
  ]);
  falso.responder("rpc:exp_trava_frete_despacho", { data: trava, error: null });
  falso.responder("expedicao_despacho_liberacoes:select", { data: liberacoesAtivas, error: null });
  falso.responder("expedicoes:select", { data: { codigo_rastreamento: null, tipo_frete: "CORREIOS", coletado_em: null }, error: null });
  falso.responder("expedicoes:upsert", { data: null, error: null });
  falso.responder("propostas:update", { data: [{ id_int: 23868 }], error: null });
  falso.responder("os_status_log:insert", { data: null, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await despachar(23868, input as any, ator);
  const up = falso.chamadas.find((x) => x.tabela === "expedicoes" && x.op === "upsert");
  return {
    res,
    payload: (up?.payload ?? null) as Record<string, unknown> | null,
    updatesPropostas: falso.chamadas.filter((x) => x.tabela === "propostas" && x.op === "update").map((x) => x.payload),
    logs: falso.chamadas.filter((x) => x.tabela === "os_status_log" && x.op === "insert").map((x) => x.payload as Record<string, unknown>),
    escritas: falso.chamadas.filter((x) => x.op !== "select").map((x) => `${x.tabela}:${x.op}`)
  };
}

{
  const r = await roda(retirada, { bloqueia: true, situacao: "PRECISA_RECOTAR", mensagem: "Recote o frete" }, []);
  confere("retirada sem liberacao (trava bloqueia): recusa com a mensagem do ADM, nada gravado", r.res.success === false && r.res.error === MENSAGEM_RETIRADA_PRECISA_LIBERAR && r.escritas.length === 0, r);
}
{
  const r = await roda(retirada, { bloqueia: false, situacao: "SEM_COTACAO" }, []);
  confere("retirada onde a trava nao avalia (SEM_COTACAO) e sem liberacao ativa: recusa, nada gravado", r.res.success === false && r.res.error === MENSAGEM_RETIRADA_PRECISA_LIBERAR && r.escritas.length === 0, r);
}
{
  const r = await roda(retirada, { bloqueia: false, situacao: "SEM_COTACAO" }, [{ id: 7 }]);
  confere("retirada onde a trava nao avalia, com liberacao ativa: despacha", r.res.success === true, r.res);
}
{
  const r = await roda(retirada, { bloqueia: false, situacao: "LIBERADO_ADM", liberacao: { id: 7 } }, []);
  const p = r.payload ?? {};
  confere("retirada liberada: sucesso", r.res.success === true, r.res);
  confere("expedicoes: CIF + RETIRA_BALCAO + Retira balcão + transportadora vazia + data e autor", p.modalidade_frete === "CIF" && p.tipo_frete === "RETIRA_BALCAO" && p.transportadora_nome === "Retira balcão" && p.id_transportadora_cliente === null && typeof p.data_despacho === "string" && p.despachado_por === "ADM Teste", p);
  confere("expedicoes NUNCA leva valor_frete, valor_total nem modalidade RETIRA", !("valor_frete" in p) && !("valor_total" in p) && p.modalidade_frete !== "RETIRA", Object.keys(p));
  confere("propostas: so status_interno -> A RETIRAR", JSON.stringify(r.updatesPropostas) === JSON.stringify([{ status_interno: "A RETIRAR" }]), r.updatesPropostas);
  const log = r.logs[0] ?? {};
  confere("os_status_log: de EXPEDICAO para A RETIRAR, quem, motivo e origem", log.status_anterior === "EXPEDICAO" && log.status_novo === "A RETIRAR" && log.ator_nome === "ADM Teste" && log.ator_uid === "u-adm" && log.motivo === MOTIVO_RETIRADA_ADM && log.origem === "EXPEDICAO_UI", log);
  confere("nenhuma outra escrita (nada em cotacao_frete, pagamentos, notas)", r.escritas.every((e) => ["expedicoes:upsert", "propostas:update", "os_status_log:insert"].includes(e)), r.escritas);
}

// ── sem a opcao: grava exatamente o mesmo que antes
{
  const semCampo = await roda(transporte, { bloqueia: false, situacao: "SEM_DIVERGENCIA" }, []);
  const comFalse = await roda({ ...transporte, retiradaNoBalcaoAdm: false }, { bloqueia: false, situacao: "SEM_DIVERGENCIA" }, []);
  const limpa = (p: Record<string, unknown> | null) => JSON.stringify({ ...(p ?? {}), updated_at: "-", data_despacho: "-" });
  confere("sem a opcao: mesmo payload de expedicoes e mesma transicao", limpa(semCampo.payload) === limpa(comFalse.payload) && JSON.stringify(semCampo.updatesPropostas) === JSON.stringify(comFalse.updatesPropostas), { a: semCampo.payload, b: comFalse.payload });
  confere("sem a opcao: CIF/CORREIOS -> EM TRANSITO, motivo nulo, sem ler liberacao", JSON.stringify(semCampo.updatesPropostas) === JSON.stringify([{ status_interno: "EM TRANSITO" }]) && semCampo.logs[0]?.motivo === null && !falso.chamadas.some((x) => x.tabela === "expedicao_despacho_liberacoes"), semCampo.logs);
  const marcaSemRetirada = await roda({ ...transporte, retiradaNoBalcaoAdm: true }, { bloqueia: false, situacao: "SEM_DIVERGENCIA" }, []);
  confere("marca sem entrega de retirada nao muda nada (transporte segue como antes)", limpa(marcaSemRetirada.payload) === limpa(semCampo.payload) && marcaSemRetirada.res.success === true, marcaSemRetirada.res);
}

// ── estrutura do modal
const modal = readFileSync(path.join(RAIZ, "src/features/expedicao/components/DespacharModal.tsx"), "utf8");
confere("modal: a opcao so com ofereceRetiradaAdm, e a modalidade continua travada", modal.includes("{ofereceRetiradaAdm && (") && modal.includes("const modalidadeTravada = modalidadeInicial !== null;"));
confere("modal: a trava e consultada com RETIRA_BALCAO na retirada e o despacho manda a marca", modal.includes('tipoFrete: tipoEntrega === "RETIRADA" ? "RETIRA_BALCAO" : tipoFrete,\n      modalidade\n') && modal.includes("retiradaNoBalcaoAdm: retiradaAdmMarcada,"));
confere("modal: sem liberacao bloqueia o botao com a mensagem do ADM", modal.includes("const travaFreteBloqueia = avaliaTrava && (trava?.bloqueia === true || bloqueioRetiradaAdm);") && modal.includes("const travaBloqueia = travaFreteBloqueia || saldoBloqueia;"));
confere("modal: retirada esconde o passo 2 e nao grava rascunho nem etiqueta sem despacho", modal.includes("&& !trocaCorreiosPendente && !retiradaAdmMarcada;") && modal.includes("disabled={salvando || retiradaAdmMarcada}") && modal.slice(modal.indexOf("async function salvarFormularioSemDespachar"), modal.indexOf("async function salvarFormularioSemDespachar") + 400).includes("if (retiradaAdmMarcada) {"));
const pagina = readFileSync(path.join(RAIZ, "src/features/expedicao/ExpedicaoPage.tsx"), "utf8");
confere("pagina: ADM pelo cadastro", pagina.includes("ehAdmNoCadastro={user?.isAdmNoCadastro === true}"));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
if (falhas) process.exitCode = 1;
