/**
 * Aviso "pedido pronto" pelo ChatGuru (06/11/2026; diálogos em 07/11): regras puras da Edge Function
 * supabase/functions/expedicao-pedido-pronto/logica.ts.
 *
 *   node --experimental-strip-types scripts/testes/expedicao-aviso-pronto.test.mts
 *
 * SEM rede e SEM banco.
 *   A. modo teste: ligado sem variável e com qualquer valor que não seja "desligado";
 *   B. modo teste: só cliente #14 (pedido e contato); desligado, qualquer um;
 *   C. telefone: tira formatação, põe 55, não mexe no nono dígito, recusa lixo;
 *   D. diálogo pela forma de envio (07/11): despacho vence orçamento; SEDEX só com
 *      rastreio; PAC e forma sem modelo ficam apagados;
 *   E. campos do diálogo (field__<Nome>), nota "—", nota do sistema antigo, cidade/UF;
 *   F. respostas: campos = 2xx + success + 200; diálogo = isso + "Diálogo executado";
 *   G. recusa por número ("Chat não encontrado.") abre o "Corrigir número";
 *   H. chave da conversa = SHA-256 de [endpoint, account, phone, número];
 *   I. diagnóstico só sem chave e sem contato; Liberar número: enviada -> executado, não -> falhou.
 */
import assert from "node:assert/strict";
import {
  CLIENTE_TESTE,
  DIALOGOS,
  LIBERACAO,
  SEM_ETIQUETA,
  SEM_MODELO,
  camposAceitos,
  camposDoDialogo,
  chaveDaConversa,
  cidadeDestino,
  conferirModoTeste,
  diagnosticoSeguro,
  dialogoExecutado,
  envioRecusado,
  escolherDialogo,
  modoTesteLigado,
  nomeDoDialogo,
  notaParaODialogo,
  numeroDaNota,
  rastreioCorreiosValido,
  recusaPorNumero,
  servicoCorreios,
  telefoneWhatsApp
} from "../../supabase/functions/expedicao-pedido-pronto/logica.ts";

let n = 0;
function caso(nome: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok - ${nome}`);
}

caso("A. modo teste ligado por padrão", () => {
  assert.equal(modoTesteLigado(undefined), true);
  assert.equal(modoTesteLigado(""), true);
  assert.equal(modoTesteLigado("false"), true);
  assert.equal(modoTesteLigado("0"), true);
  assert.equal(modoTesteLigado(" Desligado "), false);
});

caso("B. modo teste só aceita o cliente #14", () => {
  assert.equal(CLIENTE_TESTE, 14);
  assert.doesNotThrow(() => conferirModoTeste(true, 14));
  assert.doesNotThrow(() => conferirModoTeste(true, "14", 14));
  assert.throws(() => conferirModoTeste(true, 15), /cliente #14/);
  assert.throws(() => conferirModoTeste(true, null), /cliente #14/);
  assert.throws(() => conferirModoTeste(true, 14, 900), /contatos do cliente #14/);
  assert.doesNotThrow(() => conferirModoTeste(false, 15, 900));
});

caso("G. recusa por número", () => {
  assert.equal(recusaPorNumero("Chat não encontrado."), true);
  assert.equal(recusaPorNumero("Chat nao encontrado"), true);
  assert.equal(recusaPorNumero("Número inválido"), true);
  assert.equal(recusaPorNumero("Mensagem vazia"), false);
  assert.equal(recusaPorNumero(null), false);
});

caso("C. telefone", () => {
  assert.equal(telefoneWhatsApp("51985018848", "55"), "5551985018848");
  assert.equal(telefoneWhatsApp("(51) 98501-8848", "55"), "5551985018848");
  assert.equal(telefoneWhatsApp("5551984608848", "55"), "5551984608848");
  assert.equal(telefoneWhatsApp("+55 (51) 84608848", "55"), "555184608848"); // sem nono dígito: fica sem
  assert.equal(telefoneWhatsApp("5184608848", "55"), "555184608848");
  assert.throws(() => telefoneWhatsApp("", "55"));
  assert.throws(() => telefoneWhatsApp(null, "55"));
  assert.throws(() => telefoneWhatsApp("abc", "55"));
  assert.throws(() => telefoneWhatsApp("123", "55"));
  assert.throws(() => telefoneWhatsApp("51985018848", ""));
  assert.throws(() => telefoneWhatsApp("+1 415 555 0100", "55"));
});

const orc = { modalidade_frete: "CIF", categoria_frete: null, id_transportadora_cliente: null, nomeTransportadora: null, servicoCotacao: null };
const esc = (o: Record<string, unknown>, despacho: Record<string, unknown> | null = null, rastreio: string | null = null) =>
  escolherDialogo({ despacho, orcamento: { ...orc, ...o }, rastreioCorreios: rastreio });

caso("D. diálogo pela forma de envio", () => {
  // Orçamento
  assert.deepEqual(esc({ modalidade_frete: "RETIRA", servicoCotacao: "SEDEX" }), { dialogo: "Retira", bloqueio: null, origem: "orcamento" });
  assert.equal(esc({ servicoCotacao: "RETIRADA" }).dialogo, "Retira");
  assert.equal(esc({ servicoCotacao: "MOTOBOY" }).dialogo, "Motoboy");
  assert.equal(esc({ servicoCotacao: "VEPPO" }).dialogo, "Veppo");
  assert.equal(esc({ servicoCotacao: "AZUL EXPRESSO" }).dialogo, "Azul");
  assert.equal(esc({ servicoCotacao: "SÃO MIGUEL" }).dialogo, "Transportadora");
  assert.equal(esc({ modalidade_frete: "FOB", id_transportadora_cliente: 4321, nomeTransportadora: "BRASPRESS" }).dialogo, "Transportadora");
  // Correios: SEDEX com rastreio; sem rastreio fica apagado; PAC e Correios sem serviço não têm modelo
  assert.deepEqual(esc({ servicoCotacao: "SEDEX" }, null, "AB123456789BR"), { dialogo: "Sedex", bloqueio: null, origem: "orcamento" });
  assert.deepEqual(esc({ servicoCotacao: "SEDEX" }), { dialogo: "Sedex", bloqueio: SEM_ETIQUETA, origem: "orcamento" });
  assert.deepEqual(esc({ servicoCotacao: "PAC" }, null, "AB123456789BR"), { dialogo: null, bloqueio: SEM_MODELO, origem: "orcamento" });
  assert.equal(esc({ servicoCotacao: "Correios" }, null, "AB123456789BR").bloqueio, SEM_MODELO);
  // Sem forma: não se usa outro diálogo
  assert.deepEqual(esc({ servicoCotacao: "Frete Incluso" }), { dialogo: null, bloqueio: SEM_MODELO, origem: "orcamento" });
  assert.equal(esc({ servicoCotacao: "Sem custo" }).dialogo, null);
  // Despacho vence orçamento
  assert.equal(esc({ servicoCotacao: "SEDEX" }, { tipo_frete: "RETIRA_BALCAO", modalidade_frete: "RETIRA" }).dialogo, "Retira");
  assert.equal(esc({ modalidade_frete: "RETIRA" }, { tipo_frete: "MOTOBOY" }).dialogo, "Motoboy");
  assert.equal(esc({ servicoCotacao: "SEDEX" }, { tipo_frete: "TRANSPORTADORA", transportadora_nome: "VEPPO" }).dialogo, "Veppo");
  assert.equal(esc({}, { tipo_frete: "TRANSPORTADORA", transportadora_nome: "AZUL CARGO ECOMM" }).dialogo, "Azul");
  assert.equal(esc({}, { tipo_frete: "TRANSPORTADORA", transportadora_nome: "EXPRESSO SAO MIGUEL S/A" }).dialogo, "Transportadora");
  assert.equal(esc({}, { tipo_frete: "TRANSPORTADORA", transportadora_nome: "SVT TRANSPORTES" }).dialogo, "Transportadora");
  assert.equal(esc({ servicoCotacao: "SEDEX" }, { tipo_frete: "CORREIOS", transportadora_nome: "PAC" }, "AB123456789BR").bloqueio, SEM_MODELO);
  assert.equal(esc({ servicoCotacao: "SEDEX" }, { tipo_frete: "CORREIOS", transportadora_nome: "CORREIOS SEDE" }, "AB123456789BR").dialogo, "Sedex");
  // Linha de expedição sem tipo declarado: vale o orçamento
  assert.equal(esc({ modalidade_frete: "RETIRA" }, { tipo_frete: null }).origem, "orcamento");
  assert.equal(servicoCorreios("PACOTE"), null);
  assert.equal(rastreioCorreiosValido(null, "ab123456789br"), "AB123456789BR");
  assert.equal(rastreioCorreiosValido("12345"), null);
});

caso("E. campos do diálogo", () => {
  const v = { idInt: 24880, notaFiscal: "—", cidadeDestino: "Santa Cruz do Sul/RS" as string | null, rastreio: null as string | null };
  assert.deepEqual(camposDoDialogo("Retira", v), { field__Pedido_Atual: "24880", field__Nota_Fiscal: "—" });
  assert.deepEqual(camposDoDialogo("Veppo", { ...v, notaFiscal: "7501" }), {
    field__Cidade_Destino: "Santa Cruz do Sul/RS",
    field__Pedido_Atual: "24880",
    field__Nota_Fiscal: "7501"
  });
  assert.deepEqual(camposDoDialogo("Sedex", { ...v, rastreio: "AB123456789BR" }), {
    field__Sedex_Conhecimento: "AB123456789BR",
    field__Pedido_Atual: "24880",
    field__Nota_Fiscal: "—"
  });
  assert.throws(() => camposDoDialogo("Sedex", v), /etiqueta dos Correios/);
  assert.throws(() => camposDoDialogo("Transportadora", { ...v, cidadeDestino: null }), /cidade de entrega/);
  assert.equal(numeroDaNota([]), "—");
  assert.equal(numeroDaNota(["7502", 7501, null, "abc", "7501"]), "7501, 7502");
  // Faturado no sistema antigo: vale o número manual da expedição
  assert.equal(notaParaODialogo({ faturadoNoSistemaAntigo: true, nfNumeroManual: "41.030", numerosDoVibe: ["7501"] }), "41030");
  assert.equal(notaParaODialogo({ faturadoNoSistemaAntigo: true, nfNumeroManual: "", numerosDoVibe: ["7501"] }), "7501");
  assert.equal(notaParaODialogo({ faturadoNoSistemaAntigo: true, nfNumeroManual: null, numerosDoVibe: [] }), "—");
  assert.equal(notaParaODialogo({ faturadoNoSistemaAntigo: false, nfNumeroManual: "6.694", numerosDoVibe: [] }), "—");
  assert.equal(cidadeDestino(" Porto  Alegre ", "rs"), "Porto Alegre/RS");
  assert.equal(cidadeDestino("", "RS"), null);
  // Nenhum campo nosso tem o nome do campo do envio de arte do Imposition
  const nossos = new Set<string>(Object.values(DIALOGOS).flatMap((d) => d.campos));
  assert.equal(nossos.has("Link_do_Cliente"), false);
  assert.equal(nomeDoDialogo("6aef3674e2ff0962de8545fc"), "Retira");
  assert.equal(nomeDoDialogo("x"), null);
});

caso("F. respostas do ChatGuru", () => {
  assert.equal(camposAceitos(200, { result: "success", code: 200 }), true);
  assert.equal(camposAceitos(200, { result: "success", code: 201 }), false);
  assert.equal(camposAceitos(302, { result: "success", code: 200 }), false);
  assert.equal(dialogoExecutado(200, { result: "success", code: 200, description: "Diálogo executado" }), true);
  assert.equal(dialogoExecutado(200, { result: "success", code: 200, description: "Dialogo executado." }), true);
  assert.equal(dialogoExecutado(200, { result: "success", code: 200, description: "Em fila" }), false);
  assert.equal(dialogoExecutado(200, { result: "success", code: 400, description: "Diálogo executado" }), false);
  assert.equal(envioRecusado(400, { result: "error", code: 400 }), true);
  assert.equal(envioRecusado(500, { result: "error", code: 400 }), false);
  assert.equal(envioRecusado(200, { result: "success", code: 200 }), false);
});

{
  // H. chave da conversa: SHA-256 hex de JSON.stringify([endpoint, account, phone, numero])
  const a = await chaveDaConversa("https://s1.chatguru.app/api/v1", "acc", "ph", "555184608848");
  const b = await chaveDaConversa("https://s1.chatguru.app/api/v1", "acc", "ph", "5551984608848");
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  const { createHash } = await import("node:crypto");
  assert.equal(a, createHash("sha256").update(JSON.stringify(["https://s1.chatguru.app/api/v1", "acc", "ph", "555184608848"])).digest("hex"));
  n++;
  console.log("ok - H. chave da conversa");
}

caso("I. diagnóstico e liberação", () => {
  const bruto = JSON.stringify({
    result: "success",
    code: 200,
    description: "Diálogo executado",
    chat_number: "555184608848",
    key: "SEGREDO123",
    nome: "Edison",
    extra: { phone_id: "abc", ok: true }
  });
  const d = diagnosticoSeguro(bruto, ["SEGREDO123", "555184608848", "Edison"]);
  assert.equal(d, '{"result":"success","code":200,"description":"Diálogo executado","extra":{"ok":true}}');
  assert.equal(diagnosticoSeguro("erro para 5551984608848 com chave SEGREDO123", ["SEGREDO123"]), "erro para [número] com chave [oculto]");
  assert.equal(diagnosticoSeguro(null), "");
  assert.equal(diagnosticoSeguro("x".repeat(900)).length, 500);
  assert.deepEqual(LIBERACAO, { enviada: "executado", nao_enviada: "falhou" });
});

console.log(`\n${n} casos ok`);
