/**
 * Birô Inter -> C6, etapa 1: PIX (18/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/banco-pix-biro.test.mts
 *
 * DUBLÊS: cliente Supabase falso e `fetch` falso no lugar do n8n. Nada sai daqui:
 * nenhum webhook do n8n e nenhum banco é chamado.
 *   A. Chave BANCO_BIRO: ausente/INTER/lixo = INTER; "C6"/"c6" = C6.
 *   B. Banco pelo formato do código: UUID = Inter; txid de 26 a 35 = C6.
 *   C. Chave em INTER: PIX da Birô igual a hoje (vibe-biro, sem cabeçalho, leitura do Inter).
 *   D. Chave em C6: vai para vibe-biro-c6, com o cabeçalho do segredo, e lê a
 *      resposta de exemplo do C6 (mesmo formato do ramo Ideal).
 *   E. Ideal e E3 não mudam com a chave em C6.
 *   F. Cancelar: o banco sai do código, nas duas posições da chave; Birô no C6
 *      exige a confirmação do banco, Birô no Inter segue pelo HTTP.
 *   G. "PIX em preparação" só para título do Inter.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const { gerarPixBancoInter } = await import("../../src/features/cobrancas/services/banco-inter.service.ts");
const biro = await import("../../src/features/cobrancas/lib/banco-pix-biro.ts");
const pix = await import("../../src/features/cobrancas/services/cancelamento-pix.ts");
const { pixEmPreparacao } = await import("../../src/features/cobrancas/lib/pix-em-preparacao.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";

const UUID_INTER = "dc06f24c-9bcc-41d9-907f-43b6829e194e";
const TXID_C6 = "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr7"; // 35, alfanumérico
const PARAMS = (idEmpresa: number) => ({
  cobrancaId: "pg-1", idEmpresa, seuNumero: "25000-A", valorNominal: 81, dataVencimento: "2026-11-20",
  telefone: "", cpfCnpj: "12345678000190", nome: "CLIENTE", endereco: "Rua A", cidade: "Porto Alegre", uf: "RS", cep: "90000000"
});
// Resposta de exemplo do C6, como o nó "Code in JavaScript1" do ramo Ideal devolve.
const RESPOSTA_C6 = {
  txid: TXID_C6, status: "ATIVA", valor: 81, chave_pix: "chave-exemplo", pix_copia_e_cola: "00020101021226C6EXEMPLO",
  location: null, expiracao_segundos: 259200, data_criacao: "2026-11-18T12:00:00.000Z", data_expiracao: "2026-11-21T12:00:00.000Z",
  nome_devedor: "CLIENTE", cpf_devedor: null, revisao: 0
};
const RESPOSTA_INTER = { cobranca: { codigoSolicitacao: UUID_INTER, situacao: "A_RECEBER" }, pix: { pixCopiaECola: "000201INTER" } };

type Chamada = { url: string; cabecalhos: Record<string, string> };
let chamadas: Chamada[] = [];
function n8nResponde(corpo: unknown, status = 200) {
  chamadas = [];
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    chamadas.push({ url: String(u), cabecalhos: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) });
    return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const gravado = () => falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update").map((c) => c.payload);

console.log("== A. chave BANCO_BIRO");
confere("ausente = INTER", biro.bancoDoPixNovoDaBiro({}) === "INTER");
confere("INTER = INTER", biro.bancoDoPixNovoDaBiro({ BANCO_BIRO: "INTER" }) === "INTER");
confere("valor estranho = INTER", biro.bancoDoPixNovoDaBiro({ BANCO_BIRO: "c 6" }) === "INTER");
confere("C6 = C6", biro.bancoDoPixNovoDaBiro({ BANCO_BIRO: "C6" }) === "C6");
confere("c6 com espaço = C6", biro.bancoDoPixNovoDaBiro({ BANCO_BIRO: " c6 " }) === "C6");

console.log("== B. banco pelo formato do código");
confere("UUID = INTER", biro.bancoDoCodigoPix(UUID_INTER) === "INTER");
confere("txid de 35 = C6", biro.bancoDoCodigoPix(TXID_C6) === "C6");
confere("txid de 26 = C6", biro.bancoDoCodigoPix("A".repeat(26)) === "C6");
confere("25 ou 36 sem hífen = desconhecido", biro.bancoDoCodigoPix("A".repeat(25)) === null && biro.bancoDoCodigoPix("A".repeat(36)) === null);
confere("vazio = desconhecido", biro.bancoDoCodigoPix("") === null && biro.bancoDoCodigoPix(null) === null);
confere("Ideal e E3 são sempre C6", biro.bancoDoPixEmitido(1, UUID_INTER) === "C6" && biro.bancoDoPixEmitido(3, null) === "C6");
confere("Birô com código desconhecido fica no Inter (como antes)", biro.bancoDoPixEmitido(2, null) === "INTER");

console.log("== C. chave em INTER: Birô igual a hoje");
{
  delete process.env.BANCO_BIRO;
  falso.zerar();
  falso.responder("pagamentos_v2:update", { data: { id: "pg-1" }, error: null });
  n8nResponde(RESPOSTA_INTER);
  const r = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS(2));
  confere("chama vibe-biro (fluxo do Inter)", chamadas.length === 1 && /\/webhook\/vibe-biro$/.test(chamadas[0].url), chamadas);
  confere("sem cabeçalho de segredo, como antes", !("x-vibe-webhook-secret" in chamadas[0].cabecalhos), chamadas[0].cabecalhos);
  confere("lê o formato do Inter e grava código e copia e cola", r.success === true && JSON.stringify(gravado()[0]) === JSON.stringify({ cod_solicitacao_inter: UUID_INTER, pix_copia_cola: "000201INTER" }), { r, g: gravado() });
}

console.log("== D. chave em C6: fluxo novo e leitura do C6");
{
  process.env.BANCO_BIRO = "C6";
  falso.zerar();
  falso.responder("pagamentos_v2:update", { data: { id: "pg-1" }, error: null });
  n8nResponde(RESPOSTA_C6);
  const r = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS(2));
  confere("chama vibe-biro-c6", chamadas.length === 1 && chamadas[0].url === biro.WEBHOOK_GERA_PIX_BIRO_C6, chamadas);
  confere("manda o cabeçalho do segredo", chamadas[0].cabecalhos["x-vibe-webhook-secret"] === "segredo-de-teste");
  confere("lê o txid e o copia e cola do C6", r.success === true && JSON.stringify(gravado()[0]) === JSON.stringify({ cod_solicitacao_inter: TXID_C6, pix_copia_cola: "00020101021226C6EXEMPLO" }), { r, g: gravado() });
  confere("não fica 'em preparação'", !r.emPreparacao);

  falso.zerar();
  n8nResponde(RESPOSTA_INTER);
  const r2 = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS(2));
  confere("resposta no formato do Inter com a chave em C6 = falha, nada gravado", r2.success === false && gravado().length === 0, r2);

  falso.zerar();
  n8nResponde({ txid: TXID_C6 });
  const r3 = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS(2));
  confere("C6 sem copia e cola = falha, nada gravado (sem 'em preparação')", r3.success === false && !r3.emPreparacao && gravado().length === 0, r3);
}

console.log("== E. Ideal e E3 não mudam com a chave em C6");
for (const [empresa, caminho] of [[1, "vibe-ideal"], [3, "vibe-e3"]] as const) {
  falso.zerar();
  falso.responder("pagamentos_v2:update", { data: { id: "pg-1" }, error: null });
  n8nResponde(RESPOSTA_C6);
  const r = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS(empresa));
  confere(`empresa ${empresa}: ${caminho}, sem cabeçalho, lê o C6`, r.success === true && chamadas[0].url.endsWith(`/webhook/${caminho}`) && !("x-vibe-webhook-secret" in chamadas[0].cabecalhos), { r, chamadas });
}

console.log("== F. cancelar: banco pelo código, nas duas posições da chave");
for (const chave of ["INTER", "C6"]) {
  process.env.BANCO_BIRO = chave;
  const corpo = (idEmpresa: number, codigo: string) => pix.corpoDoCancelamentoPix({ codigoDoBanco: codigo, idEmpresa });

  n8nResponde({ success: true });
  await pix.chamarCancelamentoDePix({ corpo: corpo(2, UUID_INTER), cabecalhos: {} });
  confere(`[${chave}] Birô com UUID -> del-pix-vibe (Inter)`, chamadas[0]?.url === pix.WEBHOOK_CANCELA_PIX, chamadas);

  n8nResponde({ success: true });
  await pix.chamarCancelamentoDePix({ corpo: corpo(2, TXID_C6), cabecalhos: {} });
  confere(`[${chave}] Birô com txid -> del-pix-biro-c6`, chamadas[0]?.url === biro.WEBHOOK_CANCELA_PIX_BIRO_C6, chamadas);

  n8nResponde({ success: true });
  await pix.chamarCancelamentoDePix({ corpo: corpo(1, TXID_C6), cabecalhos: {} });
  confere(`[${chave}] Ideal com txid -> del-pix-vibe (igual a hoje)`, chamadas[0]?.url === pix.WEBHOOK_CANCELA_PIX, chamadas);

  const okSemConfirmacao = { tipo: "RESPOSTA" as const, ok: true, status: 200, texto: '{"success":true}' };
  const removida = { tipo: "RESPOSTA" as const, ok: true, status: 200, texto: '{"success":true,"cancelado":true,"status":"REMOVIDA_PELO_USUARIO_RECEBEDOR"}' };
  const ativa = { tipo: "RESPOSTA" as const, ok: true, status: 200, texto: '{"success":true,"cancelado":false,"status":"ATIVA"}' };
  confere(`[${chave}] Birô no Inter: HTTP ok cancela (regra de hoje)`, pix.decidirCancelamentoDePix(2, okSemConfirmacao, UUID_INTER).cancelarNoVibe === true);
  confere(`[${chave}] Birô no C6: HTTP ok sem confirmação NÃO cancela`, pix.decidirCancelamentoDePix(2, okSemConfirmacao, TXID_C6).cancelarNoVibe === false);
  confere(`[${chave}] Birô no C6: REMOVIDA cancela`, pix.decidirCancelamentoDePix(2, removida, TXID_C6).cancelarNoVibe === true);
  confere(`[${chave}] Birô no C6: ATIVA não cancela`, pix.decidirCancelamentoDePix(2, ativa, TXID_C6).desfecho === "PIX_ATIVO_NO_BANCO");
  confere(`[${chave}] Ideal: regra de hoje (confirmação)`, pix.decidirCancelamentoDePix(1, okSemConfirmacao, TXID_C6).cancelarNoVibe === false);
}
delete process.env.BANCO_BIRO;

console.log("== G. 'PIX em preparação' só no Inter");
const base = { tipo_cobranca: "PIX", id_empresa: 2, pix_copia_cola: null, status: "A_RECEBER" };
confere("Birô, UUID sem QR = em preparação", pixEmPreparacao({ ...base, cod_solicitacao_inter: UUID_INTER }) === true);
confere("Birô, txid do C6 sem QR = não", pixEmPreparacao({ ...base, cod_solicitacao_inter: TXID_C6 }) === false);
confere("Ideal, txid sem QR = não (como antes)", pixEmPreparacao({ ...base, id_empresa: 1, cod_solicitacao_inter: TXID_C6 }) === false);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
