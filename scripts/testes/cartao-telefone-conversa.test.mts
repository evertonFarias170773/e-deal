/**
 * Cartão C6, três empresas (23/11/2026): telefone da conversa principal e mensagem de erro.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cartao-telefone-conversa.test.mts
 *
 * DUBLÊS: cliente Supabase falso. Nada sai daqui (nem n8n, nem C6).
 *   A. A cópia de telefoneParaApi na Edge é igual à do Vibe.
 *   B. A página mostra a explicação do fluxo; no telefone, o texto simples. A função
 *      funciona depois de embutida no <script> (toString).
 *   C. Cadeia do telefone do pagador: conversa principal antes do cadastro; só celular
 *      de 11 dígitos com o 9; estrangeiro e fixo da conversa não servem.
 *   D. Área do cliente: com celular (conversa ou cadastro) segue; sem celular, avisa antes.
 *   E. Edge e área do cliente usam a regra (fonte).
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
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
const vibe = await import("../../src/lib/telefone/telefone-br.ts");
const edgeTel = await import("../../supabase/functions/pagamento-publico/telefone-conversa.ts");
const edgeMsg = await import("../../supabase/functions/pagamento-publico/mensagem-checkout.ts");
const area = await import("../../src/features/area-cliente/services/area-cliente.server.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

console.log("== A. telefoneParaApi: Edge = Vibe");
const amostras = [
  "555484296757", "5554984296757", "54984296757", "5484296757", "5484296771", "(54) 3029-1234", "+55 51 3093-2840",
  "59895038797", "5989503879", "16505551234", "1234567890", "", null, undefined, "abc", "55", "0054984296757",
  "5511912345678", "11912345678", "1112345678", "2112345678", "99999999999", "20999999999", 51984608848, "55 21 7777-8888"
];
for (const a of amostras) {
  confere(`${JSON.stringify(a)} -> ${JSON.stringify(vibe.telefoneParaApi(a))}`, edgeTel.telefoneParaApi(a) === vibe.telefoneParaApi(a), { edge: edgeTel.telefoneParaApi(a) });
}

console.log("== B. mensagem da página");
const TEXTO = vibe.MENSAGEM_CARTAO_SEM_CELULAR;
const falhaTelefone = { success: false, causa: "TELEFONE_INVALIDO", http_status: 422, error: "Telefone do cliente ausente ou invalido no cadastro. Informe um CELULAR..." };
confere("telefone: texto simples para o cliente", edgeMsg.mensagemDaFalhaDoCheckout(falhaTelefone, 422) === TEXTO);
confere("texto da Edge = texto do Vibe", TEXTO === "Não encontramos um celular válido para o pagamento com cartão. Fale com o seu vendedor.");
confere("outra falha: a explicação do fluxo (campo error)", edgeMsg.mensagemDaFalhaDoCheckout({ success: false, causa: "C6_RECUSOU", error: "O C6 recusou: valor minimo" }, 400) === "O C6 recusou: valor minimo");
confere("campo erro continua valendo", edgeMsg.mensagemDaFalhaDoCheckout({ erro: "Pagamento não encontrado" }, 404) === "Pagamento não encontrado");
confere("campo message continua valendo", edgeMsg.mensagemDaFalhaDoCheckout({ message: "Workflow falhou" }, 500) === "Workflow falhou");
confere("error como objeto", edgeMsg.mensagemDaFalhaDoCheckout({ error: { message: "Falha X" } }, 500) === "Falha X");
confere("sem explicação: genérico de antes", edgeMsg.mensagemDaFalhaDoCheckout({}, 422) === "Erro ao criar checkout no C6. Status: 422");
confere("resposta que não é JSON (data vazio)", edgeMsg.mensagemDaFalhaDoCheckout(undefined, 502) === "Erro ao criar checkout no C6. Status: 502");
// Como a página faz: a função vai para o <script> pelo toString e roda no navegador.
const embutida = new Function(`const f = ${edgeMsg.mensagemDaFalhaDoCheckout.toString()}; return f;`)() as (d: unknown, s: number) => string;
confere("embutida no <script>: telefone", embutida(falhaTelefone, 422) === TEXTO);
confere("embutida no <script>: genérico", embutida({}, 422) === "Erro ao criar checkout no C6. Status: 422");
confere("o código embutido não fecha o <script>", !/<\/script/i.test(edgeMsg.mensagemDaFalhaDoCheckout.toString()));

console.log("== C. cadeia do telefone do pagador (espelho do n8n)");
const cel = { somenteCelular: true };
const r1 = vibe.resolverTelefonePagador({ telefoneConversa: "555484296757", telefoneFixo: "5484296771" }, cel);
confere("25629: conversa 55+DDD+8 dígitos ganha o 9 e passa", r1.valido && r1.telefone === "54984296757" && r1.origem === "Conversa principal do pedido", r1);
const r2 = vibe.resolverTelefonePagador({ telefoneFixo: "5484296771" }, cel);
confere("só fixo e sem conversa: barrado", !r2.valido && r2.telefone === "", r2);
const r3 = vibe.resolverTelefonePagador({ telefoneConversa: "555430291234", whatsapp1: "51984608848" }, cel);
confere("conversa com fixo: não serve, cai no WhatsApp do cadastro", r3.valido && r3.telefone === "51984608848" && r3.origem === "WhatsApp 1", r3);
const r4 = vibe.resolverTelefonePagador({ telefoneConversa: "59895038797", whatsapp1: "" }, cel);
confere("conversa estrangeira: sai vazia (e sem cadastro, barrado)", !r4.valido, r4);
const r5 = vibe.resolverTelefonePagador({ whatsapp1: "51984608848", telefoneFixo: "5130932840" }, cel);
confere("sem conversa, celular no cadastro: igual a antes", r5.valido && r5.telefone === "51984608848" && r5.origem === "WhatsApp 1", r5);
const r6 = vibe.resolverTelefonePagador({ telefoneConversa: "5551999998888", whatsapp1: "51984608848" }, cel);
confere("conversa vem antes do cadastro", r6.telefone === "51999998888" && r6.origem === "Conversa principal do pedido", r6);
const r7 = vibe.resolverTelefonePagador({ telefoneFixo: "5130932840" });
confere("fora do cartão (sem somenteCelular) o fixo segue valendo", r7.valido && r7.telefone === "5130932840", r7);

console.log("== D. área do cliente");
const service = getSupabaseClient() as never;
falso.zerar();
falso.responder("propostas_contatos_chatguru:select", { data: { telefone: "555484296757" }, error: null });
confere("conversa com celular: segue", (await area.pagadorTemCelularParaCartao(service, 25629, { whatsapp_1: "", whatsapp_2: "", telefone_fixo: "5484296771" })) === true);
const leitura = falso.chamadas.find((c) => c.tabela === "propostas_contatos_chatguru");
confere("lê a conversa PRINCIPAL do pedido", JSON.stringify(leitura?.filtros) === JSON.stringify([["eq", ["id_int", 25629]], ["eq", ["principal", true]]]), leitura?.filtros);
falso.zerar();
falso.responder("propostas_contatos_chatguru:select", { data: null, error: null });
confere("sem conversa e só fixo: avisa", (await area.pagadorTemCelularParaCartao(service, 1, { whatsapp_1: null, whatsapp_2: null, telefone_fixo: "5484296771" })) === false);
confere("sem conversa, WhatsApp 2 com celular: segue", (await area.pagadorTemCelularParaCartao(service, 1, { whatsapp_1: "", whatsapp_2: "(51) 98460-8848", telefone_fixo: "" })) === true);
falso.zerar();
falso.responder("propostas_contatos_chatguru:select", { data: null, error: { message: "falha de rede" } });
confere("conversa ilegível + celular no cadastro: segue (não bloqueia por falha de leitura)", (await area.pagadorTemCelularParaCartao(service, 1, { whatsapp_1: "51984608848", whatsapp_2: null, telefone_fixo: null })) === true);
confere("conversa ilegível + só fixo: avisa", (await area.pagadorTemCelularParaCartao(service, 1, { whatsapp_1: null, whatsapp_2: null, telefone_fixo: "5130932840" })) === false);

console.log("== E. fontes usam a regra");
const RAIZ = path.join(AQUI, "..", "..");
const edgeIndex = readFileSync(path.join(RAIZ, "supabase/functions/pagamento-publico/index.ts"), "utf8");
confere("Edge lê a conversa principal pelo id_int da cobrança", /from\("propostas_contatos_chatguru"\)[\s\S]{0,120}\.eq\("id_int", pagamento\.id_int\)[\s\S]{0,60}\.eq\("principal", true\)/.test(edgeIndex));
confere("Edge manda telefone_conversa ao webhook do cartão", /token_publico: "\$\{token\}",\s*telefone_conversa: TELEFONE_CONVERSA/.test(edgeIndex));
confere("Edge mostra a falha pela mensagemDaFalhaDoCheckout", edgeIndex.includes("alert(mensagemDaFalhaDoCheckout(data, response.status));") && !edgeIndex.includes('alert(data.erro || data.message || "Erro ao criar checkout'));
const areaFonte = readFileSync(path.join(RAIZ, "src/features/area-cliente/services/area-cliente.server.ts"), "utf8");
const iCheca = areaFonte.indexOf("pagadorTemCelularParaCartao(service, idInt, pagador)");
const iInsere = areaFonte.search(/\.from\("pagamentos_v2"\)\s*\.insert\(/);
confere("área do cliente: o aviso vem ANTES de criar a cobrança", iCheca > 0 && iInsere > 0 && iCheca < iInsere, { iCheca, iInsere });
confere("área do cliente: avisa com o mesmo texto", areaFonte.includes('{ ok: false, codigo: "DADOS", mensagem: MENSAGEM_CARTAO_SEM_CELULAR }'));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
