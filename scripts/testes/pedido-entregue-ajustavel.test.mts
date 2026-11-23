/**
 * Pedido ENTREGUE com valor ajustável (23/11/2026, regra do Everton, caso 24830).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/pedido-entregue-ajustavel.test.mts
 *
 * SEM banco: cliente Supabase falso (só anota) e Salvar falso (anota as options).
 * Prova:
 *   - entregue sem nota, sem título e sem valor recebido edita, com permissão e
 *     motivo; o faturado vai para o valor novo, sem Conta Corrente, e o motivo
 *     vai para o chat; nada em expedicoes nem em status_interno;
 *   - entregue com nota, com título, com valor recebido, sem permissão, sem
 *     motivo ou com cobrança autorizada que levaria a diferença à Conta
 *     Corrente continua recusado, sem gravar nada;
 *   - pedido não entregue: igual a hoje (sem motivo, sem a nova linha de chat).
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    if (/(^|\/)orcamentos\.service(\.ts)?$/.test(especificador)) return { url: url("_save-proposta-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { falso } = await import("./_supabase-falso.mts");
const { saveFalso } = await import("./_save-proposta-falso.mts");
const rota = await import("../../src/app/api/orcamentos/editar-paga/route.ts");
const regra = await import("../../src/features/orcamentos/lib/entregue-ajustavel.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A regra pura ─────────────────────────────────────────────────────────────
console.log("== regra");
const faturado = { id_pagamento: "24830-A", tipo_cobranca: "E-FATURADO", status: "A_VENCER", paid_at: null };
const nfe = (status: string, ambiente = "producao") => ({ tipo: "NFE" as const, numero: "41000", status, ambiente });
const av = (e: Partial<Parameters<typeof regra.avaliarAjusteEntregue>[0]>) =>
  regra.avaliarAjusteEntregue({ notas: [], titulos: [], cobrancas: [faturado], ...e });

confere("24830: sem nota, sem título, E-Faturado a vencer -> ajustável", av({}).ajustavel === true);
confere("sem cobrança nenhuma -> ajustável (a permissão e o motivo seguem exigidos na rota)", av({ cobrancas: [] }).ajustavel === true);
for (const st of ["AUTORIZADA", "PENDENTE", "RETORNO_FOCUS", "ERRO_AUTORIZACAO"]) {
  const r = av({ notas: [nfe(st)] });
  confere(`nota de produção ${st} trava`, !r.ajustavel && r.motivo === "NOTA_FISCAL", r);
}
confere("NFS-e autorizada trava", (av({ notas: [{ tipo: "NFSE", numero: "12", status: "AUTORIZADA", ambiente: "producao" }] }) as { motivo?: string }).motivo === "NOTA_FISCAL");
confere("nota CANCELADA não trava", av({ notas: [nfe("CANCELADA")] }).ajustavel === true);
confere("nota de homologação não trava", av({ notas: [nfe("AUTORIZADA", "homologacao")] }).ajustavel === true);
for (const st of ["A_VENCER", "VENCIDO", "PAID", "A_RECEBER"]) {
  const r = av({ titulos: [{ status: st }] });
  confere(`título ${st} trava`, !r.ajustavel && r.motivo === "TITULO_ATIVO", r);
}
confere("título CANCELADO não trava", av({ titulos: [{ status: "CANCELADO" }] }).ajustavel === true);
const pix = { id_pagamento: "X-B", tipo_cobranca: "PIX", status: "PAID", paid_at: "2026-11-20T10:00:00Z" };
confere("cobrança PAID trava", (av({ cobrancas: [faturado, pix] }) as { motivo?: string }).motivo === "VALOR_RECEBIDO");
confere("A_VENCER com paid_at trava", (av({ cobrancas: [{ ...faturado, paid_at: "2026-11-20" }] }) as { motivo?: string }).motivo === "VALOR_RECEBIDO");
confere("status desconhecido trava por segurança", (av({ cobrancas: [{ ...faturado, status: "QUITADO" }] }) as { motivo?: string }).motivo === "VALOR_RECEBIDO");
confere("PIX A_RECEBER (link não pago) não é valor recebido", av({ cobrancas: [faturado, { ...pix, status: "A_RECEBER", paid_at: null }] }).ajustavel === true);
confere("cobrança CANCELADO paga antes não conta", av({ cobrancas: [faturado, { ...pix, status: "CANCELADO" }] }).ajustavel === true);
confere("motivo: curto recusado, longo limpo", regra.motivoEntregueValido("  curto ") === null && regra.motivoEntregueValido("  valor   renegociado com o cliente ") === "valor renegociado com o cliente");

// ── A rota ───────────────────────────────────────────────────────────────────
const FATURADO_LINHA = {
  id: "aefa570d", id_int: 24830, id_pagamento: "24830-A", tipo_cobranca: "E-FATURADO", status: "A_VENCER",
  confirmado: true, paid_at: null, valor: 1210.95, obs_v2: null, chave_reenvio: null
};

function preparar(o: {
  status?: string;
  cobrancas?: Record<string, unknown>[];
  notas?: Record<string, unknown>[];
  titulos?: Record<string, unknown>[];
  permissoes?: string[];
  novoTotal?: number;
}) {
  falso.zerar();
  saveFalso.zerar(o.novoTotal ?? 1000);
  falso.responder("propostas:select", {
    data: { id_int: 24830, id_cliente: 57415, valor_total: 1210.95, is_avulso: false, modalidade_frete: "CIF", valor_frete: 90.95, status_interno: o.status ?? "ENTREGUE" },
    error: null
  });
  falso.responder("pagamentos_v2:select", { data: o.cobrancas ?? [FATURADO_LINHA], error: null });
  falso.responder("notas_fiscais:select", { data: o.notas ?? [], error: null });
  falso.responder("notas_servico:select", { data: [], error: null });
  falso.responder("boletos:select", { data: o.titulos ?? [], error: null });
  falso.responder("usuarios:select", { data: { id_perfil: 2, is_super_adm: false, is_admin: false, nome_usuario: "Marielle Fonseca" }, error: null });
  falso.responder("perfis:select", { data: { permissoes: o.permissoes ?? ["propostas.editar_paga"] }, error: null });
}

async function salvar(motivoEntregue?: string) {
  const resposta = await rota.POST(
    new Request("http://localhost/api/orcamentos/editar-paga", {
      method: "POST",
      headers: { authorization: "Bearer token-de-teste", "content-type": "application/json" },
      body: JSON.stringify({
        formState: { id_int: 24830 }, idInt: 24830, idCliente: 57415, novoTotal: 1000,
        userEmail: "x@y", userName: "Teste", faturadoEsperadoId: "aefa570d", motivoEntregue
      })
    }) as never
  );
  const json = (await resposta.json()) as Record<string, unknown>;
  const escritas = falso.chamadas.filter((c) => c.op !== "select" || c.tabela.startsWith("rpc:"));
  return { status: resposta.status, json, escritas };
}
const MOTIVO = "Valor do produto renegociado com o cliente antes da nota";
const semEscrita = (r: { escritas: unknown[] }) => r.escritas.length === 0 && saveFalso.chamadas.length === 0;

console.log("== 24830: entregue, sem nota, sem título, E-Faturado confirmado não pago");
preparar({});
{
  const r = await salvar(MOTIVO);
  confere("salva (200)", r.status === 200 && r.json.success === true, r.json);
  const opt = saveFalso.chamadas[0]?.options ?? {};
  confere("Salvar com force e pedidoEntregueConferido", opt.force === true && opt.pedidoEntregueConferido === true, opt);
  const upd = r.escritas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update");
  confere("faturado vai para o valor novo (1.000,00) e volta ao Registro de recebíveis",
    upd.length === 1 && JSON.stringify(upd[0].payload) === JSON.stringify({ valor: 1000, boleto_enviadoo: false }), upd);
  confere("sem Conta Corrente (nem pendência, nem cc_abrir_pendencia)",
    !r.escritas.some((c) => c.tabela.includes("conta_corrente") || c.tabela === "rpc:cc_abrir_pendencia"), r.escritas.map((c) => c.tabela));
  confere("diferença devolvida 0 e sem pendência", r.json.diferenca === 0 && r.json.pendenciaAtiva === null, r.json);
  const chats = r.escritas.filter((c) => c.tabela === "propostas_chat").map((c) => JSON.stringify(c.payload));
  confere("chat: linha do faturado ajustado e linha do entregue com o motivo e os totais",
    chats.length === 2 && chats.some((t) => t.includes("Valor da cobrança ajustado de R$ 1210,95 para R$ 1000,00")) &&
      chats.some((t) => t.includes("Pedido ENTREGUE alterado por Marielle Fonseca") && t.includes(MOTIVO) && t.includes("Status e datas de envio não mudaram")),
    chats);
  confere("nada em expedicoes nem em propostas (status e datas de envio intactos)",
    !r.escritas.some((c) => c.tabela === "expedicoes" || c.tabela === "propostas"), r.escritas.map((c) => `${c.op} ${c.tabela}`));
  confere("escritas: só o faturado e o chat", r.escritas.every((c) => ["pagamentos_v2", "propostas_chat"].includes(c.tabela)), r.escritas.map((c) => `${c.op} ${c.tabela}`));
}

console.log("== mesma situação, permissão só Editar Faturado");
preparar({ permissoes: ["propostas.editar_faturado"] });
{
  const r = await salvar(MOTIVO);
  confere("salva (200)", r.status === 200 && r.json.success === true, r.json);
}

console.log("== recusas, nada gravado");
const casos: Array<[string, Parameters<typeof preparar>[0], string | undefined, number, RegExp]> = [
  ["NF-e de venda autorizada", { notas: [{ numero_nf: 41700, status: "AUTORIZADA", ambiente: "producao" }] }, MOTIVO, 409, /nota fiscal \(NF-e 41700/],
  ["NF-e de remessa em processamento (PENDENTE)", { notas: [{ numero_nf: null, status: "PENDENTE", ambiente: "producao" }] }, MOTIVO, 409, /nota fiscal/],
  ["título ativo no Contas a Receber", { titulos: [{ status: "A_VENCER", parcela: 1, total_parcelas: 1 }] }, MOTIVO, 409, /título\(s\) ativo/],
  ["valor recebido (PIX pago)", { cobrancas: [FATURADO_LINHA, { ...FATURADO_LINHA, id: "p2", id_pagamento: "24830-B", tipo_cobranca: "PIX", status: "PAID", paid_at: "2026-11-20" }] }, MOTIVO, 409, /valor recebido \(24830-B\)/],
  ["sem Editar Proposta Paga nem Editar Faturado", { permissoes: ["propostas.edit", "cobrancas.view"] }, MOTIVO, 403, /Editar Proposta Paga ou Editar Faturado/],
  ["sem motivo", {}, undefined, 400, /motivo/],
  ["motivo curto", {}, "ajuste", 400, /mínimo de 10/],
  ["E-Retrabalho confirmado (iria para a Conta Corrente)", { cobrancas: [{ ...FATURADO_LINHA, tipo_cobranca: "E-RETRABALHO" }] }, MOTIVO, 409, /Conta Corrente/]
];
for (const [nome, cenario, motivo, status, texto] of casos) {
  preparar(cenario);
  const r = await salvar(motivo);
  confere(`${nome}: ${status}`, r.status === status && texto.test(String(r.json.error ?? "")), { status: r.status, json: r.json });
  confere(`${nome}: nada gravado, Salvar não chamado`, semEscrita(r), r.escritas);
}

console.log("== falha de leitura das notas nunca libera");
preparar({});
falso.responder("notas_fiscais:select", { data: null, error: { message: "timeout" } });
{
  const r = await salvar(MOTIVO);
  confere("500, nada gravado", r.status === 500 && semEscrita(r), r);
}

console.log("== pedido não entregue: igual a hoje");
preparar({ status: "EM TRANSITO" });
{
  const r = await salvar();
  confere("salva sem motivo (200)", r.status === 200 && r.json.success === true, r.json);
  const opt = saveFalso.chamadas[0]?.options ?? {};
  confere("sem pedidoEntregueConferido", opt.pedidoEntregueConferido === false, opt);
  confere("não lê notas nem consulta o entregue", !falso.chamadas.some((c) => c.tabela === "notas_fiscais" || c.tabela === "notas_servico"));
  const chats = r.escritas.filter((c) => c.tabela === "propostas_chat").map((c) => JSON.stringify(c.payload));
  confere("chat: só a linha do faturado, como antes", chats.length === 1 && !chats[0].includes("ENTREGUE"), chats);
}

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
