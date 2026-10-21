/**
 * Prepostagem: so gera outra com confirmacao valida (21/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/prepostagem-regeracao.test.mts
 *
 * SEM banco e SEM Correios: cliente Supabase falso (_supabase-falso.mts) e `cws` falso (_cws-falso.mts), que so
 * CONTA as chamadas a `criarPrepostagem`. Nada sai desta maquina.
 *
 *   1. Primeira geracao (sem prepostagem): igual a antes — gera uma vez, grava o codigo, nao mexe no `_anterior`.
 *   2. Segunda chamada SEM confirmacao: 409 com o codigo atual e `criarPrepostagem` NAO roda.
 *   3. Com `substituir` e o codigo certo: gera, e o codigo que estava vivo desce para o `_anterior`.
 *   4. Codigo visto diferente do gravado: 409, nada e gerado. `substituir` sem codigo tambem.
 *   5. Prepostagem marcada como cancelada no portal: nao pede confirmacao.
 *   6. A autorizacao continua no servidor: sem `expedicao.processar` e 403 e nada e gerado.
 *   7. Autoria: cada geracao grava uma linha em os_status_log com autor e codigo, e nao muda status.
 *   8. Decisao pura (regeracao-prepostagem.ts).
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (nome: string) => pathToFileURL(path.join(AQUI, nome)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: url("_supabase-falso.mts"), shortCircuit: true };
    if (especificador === "@/lib/supabase/server") return { url: url("_supabase-server-falso.mts"), shortCircuit: true };
    if (especificador === "@/lib/correios/cws") return { url: url("_cws-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const { correiosFalso } = await import("./_cws-falso.mts");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
const { POST } = await import("../../src/app/api/expedicao/correios/prepostagem/route.ts");
const { decidirGeracaoPrepostagem, motivoDaGeracaoPrepostagem } = await import("../../src/features/expedicao/lib/regeracao-prepostagem.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const PEDIDO = 23891;
type Exp = Record<string, unknown>;
const SEM_PREPOSTAGEM: Exp = { peso_kg: 1, data_despacho: "2026-10-21T18:23:42Z", correios_id_prepostagem: null, correios_codigo_objeto: null, correios_id_prepostagem_anterior: null, prepostagem_cancelada_em: null };
const COM_PREPOSTAGEM: Exp = { ...SEM_PREPOSTAGEM, correios_id_prepostagem: "PRatual", correios_codigo_objeto: "AE055259112BR" };

function preparar(exp: Exp, perfil: "ADMIN" | "SEM_PERMISSAO" = "ADMIN") {
  falso.zerar();
  correiosFalso.zerar();
  if (perfil === "SEM_PERMISSAO") {
    falso.responder("usuarios:select", { data: { id_perfil: 9, is_super_adm: false, is_admin: false, nome_usuario: "Sem Permissao" }, error: null });
    falso.responder("perfis:select", { data: { permissoes: ["expedicao.visualizar"] }, error: null });
  } else {
    falso.responder("usuarios:select", { data: { id_perfil: 1, is_super_adm: true, is_admin: true, nome_usuario: "Celi Santana" }, error: null });
  }
  falso.responder("propostas:select", {
    data: { id_int: PEDIDO, cliente: "ALLARTE", id_cliente: 14, id_faturado: null, empresa: "E3 BRINDES LTDA", cep: "12600000", id_endereco_ent: "e1", modalidade_frete: "CIF", id_transportadora_cliente: null, status_interno: "EXPEDICAO" },
    error: null
  });
  falso.responder("expedicoes:select", { data: exp, error: null });
  falso.responder("cotacao_frete:select", { data: null, error: null });
  falso.responder("produtos_proposta:select", { data: [], error: null });
  falso.responder("enderecos:select", { data: { endereco: "Rua A", numero: "1", complemento: "", bairro: "Centro", cidade: "Lorena", uf: "SP", cep: "12600000", recebedor: null }, error: null });
  falso.responder("clientes:select", { data: { nome: "ALLARTE", fantasia: null, whatsapp_1: "51995506078", telefone_fixo: null }, error: null });
  falso.responder("empresas:select", { data: { id: 3, razao_social: "E3", nome_fantasia: "E3 BRINDES", cnpj: "00000000000191", cep: "90000000", logradouro: "R", numero: "1", complemento: "", bairro: "B", municipio: "Porto Alegre", uf: "RS", telefone_nfe: "5130000000" }, error: null });
}

async function chamar(corpo: Record<string, unknown>) {
  const requisicao = new Request("http://localhost/api/expedicao/correios/prepostagem", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ id_int: PEDIDO, servico: "SEDEX", ...corpo })
  });
  const resposta = await POST(requisicao as never);
  const json = (await resposta.json()) as Record<string, any>;
  const gravacoes = falso.chamadas.filter((c) => c.op !== "select");
  return {
    status: resposta.status,
    json,
    criou: correiosFalso.chamadas.length,
    upserts: gravacoes.filter((c) => c.tabela === "expedicoes" && c.op === "upsert"),
    logs: gravacoes.filter((c) => c.tabela === "os_status_log" && c.op === "insert")
  };
}

// ── 1. primeira geracao: igual a antes
console.log("== 1. primeira geracao ==");
{
  preparar(SEM_PREPOSTAGEM);
  const r = await chamar({});
  confere("200, success e o codigo novo", r.status === 200 && r.json.success === true && r.json.codigoObjeto === "AE000000001BR", r);
  confere("criarPrepostagem roda UMA vez", r.criou === 1, r.criou);
  const p = (r.upserts[0]?.payload ?? {}) as Record<string, unknown>;
  confere("grava o id e o codigo novos", r.upserts.length === 1 && p.correios_id_prepostagem === "PRfalso1" && p.correios_codigo_objeto === "AE000000001BR", p);
  confere("nao mexe no _anterior nem na marca de cancelamento (primeira geracao)", !("correios_codigo_objeto_anterior" in p) && !("prepostagem_cancelada_em" in p), Object.keys(p));
}
{
  // mesmo resultado com confirmacao a mais: nada a confirmar quando nao ha prepostagem
  preparar(SEM_PREPOSTAGEM);
  const r = await chamar({ substituir: true, codigo_visto: "qualquer" });
  confere("sem prepostagem, mandar substituir e codigo nao atrapalha: gera", r.status === 200 && r.criou === 1, r);
}

// ── 2. segunda chamada sem confirmacao
console.log("== 2. sem confirmacao ==");
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({});
  confere("409 PREPOSTAGEM_JA_EXISTE com o codigo atual", r.status === 409 && r.json.code === "PREPOSTAGEM_JA_EXISTE" && r.json.codigoAtual === "AE055259112BR" && r.json.success === false, r);
  confere("criarPrepostagem NAO roda", r.criou === 0, r.criou);
  confere("nada e gravado (nem expedicoes, nem trilha)", r.upserts.length === 0 && r.logs.length === 0);
}
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({ substituir: false, codigo_visto: "AE055259112BR" });
  confere("substituir:false com o codigo certo tambem e 409", r.status === 409 && r.criou === 0, r);
}
{
  // so o id da prepostagem gravado (sem codigo do objeto): tambem e prepostagem viva
  preparar({ ...SEM_PREPOSTAGEM, correios_id_prepostagem: "PRsoId" });
  const r = await chamar({});
  confere("so correios_id_prepostagem gravado: 409 com o id como codigo atual", r.status === 409 && r.json.codigoAtual === "PRsoId" && r.criou === 0, r);
}

// ── 3. com confirmacao valida
console.log("== 3. com substituir e o codigo certo ==");
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({ substituir: true, codigo_visto: "AE055259112BR" });
  confere("200 e o codigo novo", r.status === 200 && r.json.success === true && r.json.codigoObjeto === "AE000000001BR", r);
  confere("criarPrepostagem roda UMA vez", r.criou === 1, r.criou);
  const p = (r.upserts[0]?.payload ?? {}) as Record<string, unknown>;
  confere("o que estava vivo desce para o _anterior", p.correios_codigo_objeto_anterior === "AE055259112BR" && p.correios_id_prepostagem_anterior === "PRatual", p);
  confere("o novo vira o vigente", p.correios_codigo_objeto === "AE000000001BR" && p.correios_id_prepostagem === "PRfalso1", p);
}

// ── 4. codigo visto diferente
console.log("== 4. codigo visto diferente ==");
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({ substituir: true, codigo_visto: "AE000000000BR" });
  confere("409 CODIGO_VISTO_DIFERENTE com o codigo gravado", r.status === 409 && r.json.code === "CODIGO_VISTO_DIFERENTE" && r.json.codigoAtual === "AE055259112BR", r);
  confere("nada e gerado nem gravado", r.criou === 0 && r.upserts.length === 0 && r.logs.length === 0);
}
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({ substituir: true });
  confere("substituir sem o codigo visto: 409", r.status === 409 && r.json.code === "CODIGO_VISTO_DIFERENTE" && r.criou === 0, r);
}
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({ substituir: true, codigo_visto: "  AE055259112BR " });
  confere("espaco nas pontas do codigo visto nao atrapalha", r.status === 200 && r.criou === 1, r);
}

// ── 5. cancelada no portal
console.log("== 5. cancelada no portal ==");
{
  preparar({ ...COM_PREPOSTAGEM, prepostagem_cancelada_em: "2026-10-21T12:00:00Z" });
  const r = await chamar({});
  confere("marcada como cancelada nao pede confirmacao: gera", r.status === 200 && r.criou === 1, r);
  const p = (r.upserts[0]?.payload ?? {}) as Record<string, unknown>;
  confere("e limpa a marca de cancelamento (como antes)", p.prepostagem_cancelada_em === null, p);
}

// ── 6. autorizacao no servidor
console.log("== 6. autorizacao ==");
{
  preparar(SEM_PREPOSTAGEM, "SEM_PERMISSAO");
  const r = await chamar({});
  confere("sem expedicao.processar: 403 e nada e gerado", r.status === 403 && r.criou === 0 && r.upserts.length === 0, r);
}
{
  preparar(COM_PREPOSTAGEM, "SEM_PERMISSAO");
  const r = await chamar({ substituir: true, codigo_visto: "AE055259112BR" });
  confere("a confirmacao nao substitui a permissao: continua 403", r.status === 403 && r.criou === 0, r);
}

// ── 7. autoria
console.log("== 7. autoria ==");
{
  preparar(SEM_PREPOSTAGEM);
  const r = await chamar({});
  const l = (r.logs[0]?.payload ?? {}) as Record<string, unknown>;
  confere("UMA linha em os_status_log", r.logs.length === 1, r.logs.length);
  confere("autor (uid e nome) vem da sessao", l.ator_uid === "usuario-de-teste" && l.ator_nome === "Celi Santana" && l.ator_tipo === "USUARIO", l);
  confere("origem propria e o codigo no motivo", l.origem === "EXPEDICAO_PREPOSTAGEM" && String(l.motivo).includes("AE000000001BR") && String(l.motivo).includes("SEDEX"), l);
  confere("nao muda status: anterior = novo = o atual", l.status_anterior === "EXPEDICAO" && l.status_novo === "EXPEDICAO" && l.resultado === "sucesso", l);
}
{
  preparar(COM_PREPOSTAGEM);
  const r = await chamar({ servico: "PAC", substituir: true, codigo_visto: "AE055259112BR" });
  const l = (r.logs[0]?.payload ?? {}) as Record<string, unknown>;
  confere("na substituicao o motivo diz o que saiu", String(l.motivo).includes("PAC") && String(l.motivo).includes("substitui AE055259112BR"), l);
}
{
  // a falha do log nao desfaz a prepostagem que ja existe nos Correios
  preparar(SEM_PREPOSTAGEM);
  falso.responder("os_status_log:insert", { data: null, error: { message: "sem permissao" } });
  const r = await chamar({});
  confere("falha ao gravar a trilha: a prepostagem continua valendo (200)", r.status === 200 && r.json.success === true && r.criou === 1, r);
}
{
  // falha dos Correios: nada e gravado
  preparar(SEM_PREPOSTAGEM);
  correiosFalso.falhar = new Error("Correios fora do ar");
  const r = await chamar({});
  confere("erro dos Correios: 502, sem upsert e sem trilha", r.status === 502 && r.upserts.length === 0 && r.logs.length === 0, r);
}

// ── 8. decisao pura
console.log("== 8. decisao pura ==");
{
  const exp = { correios_codigo_objeto: "AE1BR", correios_id_prepostagem: "PR1", prepostagem_cancelada_em: null };
  confere("sem nada: gera", decidirGeracaoPrepostagem({ exp: null, substituir: false, codigoVisto: null }).acao === "gerar");
  confere("viva sem confirmacao: recusa", decidirGeracaoPrepostagem({ exp, substituir: false, codigoVisto: "AE1BR" }).acao === "recusar");
  confere("viva, confirmada com o codigo certo: gera", decidirGeracaoPrepostagem({ exp, substituir: true, codigoVisto: "AE1BR" }).acao === "gerar");
  confere("viva, codigo errado: recusa", decidirGeracaoPrepostagem({ exp, substituir: true, codigoVisto: "AE2BR" }).acao === "recusar");
  confere("o codigo do objeto vale mais que o id", (decidirGeracaoPrepostagem({ exp, substituir: false, codigoVisto: null }) as { codigoAtual: string }).codigoAtual === "AE1BR");
  confere("motivo sem substituicao", motivoDaGeracaoPrepostagem({ servico: "SEDEX", codigoNovo: "AE9BR", codigoSubstituido: null }) === "Prepostagem SEDEX gerada: AE9BR");
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
