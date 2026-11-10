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
 *   G. recusa por número ("Chat não encontrado.") abre o "Ver conversas do cliente";
 *   H. chave da conversa = SHA-256 de [endpoint, account, phone, número];
 *   I. diagnóstico só sem chave e sem contato; Liberar número: enviada -> executado, não -> falhou;
 *   J. Testar modelo: só modo teste e cliente #14; campos que faltam vão com valor de teste;
 *   K. Pedido em Produção: diálogo próprio, fora da lista da Expedição, sem campos;
 *   L. conversa do ChatGuru (09/11): DDD + 8 últimos casa com uma -> automática;
 *      várias ou nenhuma -> escolha; sem conversa -> não envia; escolha só do cliente;
 *   M. produção (09/11): só modo teste + cliente #14; Link_do_Cliente do próprio pedido;
 *   N. regra dos 120 s do ChatGuru: recusa explícita (falhou), com a mensagem da tela;
 *   O. v19: pausa CHATGURU_AVISOS_PAUSA (vazio ou "desligada" envia; o resto pausa);
 *   P. v19: trava compartilhada (chave vibe:<id>, só "reservado" envia, erro = nada
 *      sai; executado solta com margem, falhou sem margem, desconhecido não solta);
 *   Q. v19: Liberar número da trava presa (só executado/falhou com conversa; modo
 *      "trava" só com modo === "trava"; a chave é sempre 'vibe:' do aviso).
 */
import assert from "node:assert/strict";
import {
  CLIENTE_TESTE,
  TEMPO_MINIMO_GURU,
  recusaTempoMinimo,
  AVISO_PRODUCAO_EM_AJUSTE,
  SEM_LINK_APROVACAO,
  conferirEnvioProducao,
  CONVERSA_TESTE_NOME,
  CONVERSA_TESTE_OCUPADA,
  INTERVALO_GURU_MS,
  SEM_CONVERSA_TESTE,
  TEXTO_HOMOLOGACAO,
  conversaDeTeste,
  conversaTesteOcupada,
  emHomologacao,
  linkDoCliente,
  SEM_CONVERSA,
  conversasEscolhidas,
  dddFinal8,
  decidirConversa,
  numeroDaConversa,
  DIALOGOS,
  DIALOGO_PRODUCAO,
  LIBERACAO,
  SEM_ETIQUETA,
  SEM_MODELO,
  camposAceitos,
  camposDeTeste,
  camposDoDialogo,
  chaveDaConversa,
  cidadeDestino,
  conferirModoTeste,
  conferirTeste,
  dialogoValido,
  diagnosticoSeguro,
  dialogoExecutado,
  textoDaResposta,
  envioRecusado,
  escolherDialogo,
  modoTesteLigado,
  nomeDoDialogo,
  notaParaODialogo,
  numeroDaNota,
  rastreioCorreiosValido,
  recusaPorNumero,
  servicoCorreios,
  telefoneWhatsApp,
  AVISOS_PAUSADOS,
  TRAVA_INDISPONIVEL,
  TRAVA_OCUPADA,
  avisosPausados,
  chaveDaTrava,
  comoSoltar,
  conferirPausa,
  resultadoTrava,
  TRAVA_NAO_PRESA,
  TRAVA_NAO_SOLTA,
  modoDaLiberacao,
  podeTerTravaPresa
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
  // Resposta real do ChatGuru (07/11/2026, teste Sedex no 24880): o texto vem em dialog_execution_return.
  const real = { code: 200, dialog_execution_return: "Diálogo Executado", result: "success" };
  assert.equal(dialogoExecutado(200, real), true);
  assert.equal(dialogoExecutado(200, { ...real, dialog_execution_return: "Em fila" }), false);
  assert.equal(dialogoExecutado(500, real), false);
  assert.equal(textoDaResposta(real), "Diálogo Executado");
  assert.equal(textoDaResposta({ description: "Chat não encontrado." }), "Chat não encontrado.");
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

caso("J. testar modelo", () => {
  assert.throws(() => conferirTeste(false, 14, 14), /modo teste ligado/);
  assert.throws(() => conferirTeste(true, 15), /cliente #14/);
  assert.throws(() => conferirTeste(true, 14, 900), /contatos do cliente #14/);
  assert.doesNotThrow(() => conferirTeste(true, 14, 14));
  assert.equal(dialogoValido("Azul"), "Azul");
  assert.equal(dialogoValido("PAC"), null);
  assert.equal(dialogoValido(undefined), null);
  // Pedido sem nada: valores de teste.
  const vazio = camposDeTeste("Sedex", { idInt: 24880, notaFiscal: "—", cidadeDestino: null, rastreio: null });
  assert.deepEqual(vazio.campos, {
    field__Sedex_Conhecimento: "TESTE000000BR",
    field__Pedido_Atual: "24880",
    field__Nota_Fiscal: "—"
  });
  assert.deepEqual(vazio.deTeste, ["Sedex_Conhecimento", "Nota_Fiscal"]);
  const veppo = camposDeTeste("Veppo", { idInt: 24880, notaFiscal: "", cidadeDestino: null, rastreio: null });
  assert.equal(veppo.campos.field__Cidade_Destino, "Porto Alegre/RS");
  assert.ok(veppo.deTeste.includes("Cidade_Destino"));
  // Pedido com tudo: valores do pedido, nenhum de teste.
  const cheio = camposDeTeste("Sedex", { idInt: 24880, notaFiscal: "7501", cidadeDestino: "Canoas/RS", rastreio: "AB123456789BR" });
  assert.deepEqual(cheio.valores, { Sedex_Conhecimento: "AB123456789BR", Pedido_Atual: "24880", Nota_Fiscal: "7501" });
  assert.deepEqual(cheio.deTeste, []);
  assert.equal(camposDeTeste("Azul", { idInt: 1, notaFiscal: "7501", cidadeDestino: "Canoas/RS", rastreio: null }).campos.field__Cidade_Destino, "Canoas/RS");
});

caso("K. pedido em produção", () => {
  assert.match(DIALOGO_PRODUCAO, /^[a-f0-9]{24}$/);
  assert.equal(DIALOGO_PRODUCAO, "6071c6dbe34a18c2cc684747");
  // Não é um dos diálogos da Expedição (não aparece no Testar modelo nem na escolha por forma de envio).
  assert.equal(nomeDoDialogo(DIALOGO_PRODUCAO), null);
  assert.ok(!Object.values(DIALOGOS).some((d) => d.id === DIALOGO_PRODUCAO));
});

caso("L. conversa do ChatGuru", () => {
  // DDD + 8 últimos: com ou sem 55, com ou sem o nono dígito, com formatação.
  assert.equal(dddFinal8("555184608848"), "5184608848");
  assert.equal(dddFinal8("(51) 98460-8848"), "5184608848");
  assert.equal(dddFinal8("+55 51 9 8460-8848"), "5184608848");
  assert.equal(dddFinal8("16996256252"), "1696256252");
  assert.equal(dddFinal8("98460-8848"), null);
  assert.equal(dddFinal8(""), null);
  assert.equal(dddFinal8(null), null);
  assert.equal(numeroDaConversa("5516996256252"), "5516996256252");
  assert.equal(numeroDaConversa("555184608848"), "555184608848");
  assert.equal(numeroDaConversa("5184608848"), null);
  const a = { chat_id: "a1", nome: "Edison Junior - 14", numero: "555184608848" };
  const b = { chat_id: "b2", nome: "Financeiro - 14", numero: "555133334444" };
  const c = { chat_id: "c3", nome: "Edison outro - 14", numero: "5551984608848" };
  const ruim = { chat_id: "x9", nome: "lixo - 14", numero: "123" };
  // Casa com exatamente uma: automática, sem perguntar.
  assert.deepEqual(decidirConversa("51984608848", [a, b]), { modo: "automatica", conversa: a });
  // Casa com mais de uma: escolha com todas as conversas válidas.
  assert.deepEqual(decidirConversa("51984608848", [a, b, c]), { modo: "escolha", motivo: "varias", conversas: [a, b, c] });
  // Não casa, mas há conversas: escolha.
  assert.deepEqual(decidirConversa("51911112222", [a, b]), { modo: "escolha", motivo: "nenhuma", conversas: [a, b] });
  assert.deepEqual(decidirConversa("", [b]), { modo: "escolha", motivo: "nenhuma", conversas: [b] });
  // Sem conversa (ou só com número inválido): não envia.
  assert.deepEqual(decidirConversa("51984608848", []), { modo: "sem_conversa" });
  assert.deepEqual(decidirConversa("51984608848", [ruim]), { modo: "sem_conversa" });
  assert.equal(SEM_CONVERSA, "Cliente sem conversa no ChatGuru (remetente 3478)");
  // Escolha da tela: só chat_id do cliente, sem repetição; todas = as válidas.
  assert.deepEqual(conversasEscolhidas(["b2", "b2"], [a, b]), [b]);
  assert.deepEqual(conversasEscolhidas(["a1", "b2"], [a, b]), [a, b]);
  assert.deepEqual(conversasEscolhidas(undefined, [a, b, ruim], true), [a, b]);
  assert.throws(() => conversasEscolhidas(["zz"], [a, b]), /não é deste cliente/);
  assert.throws(() => conversasEscolhidas([], [a, b]), /ao menos uma/);
  assert.throws(() => conversasEscolhidas(undefined, [ruim], true), /sem conversa/);
});

caso("M. produção: link do cliente e bloqueio", () => {
  // Bloqueio: só com o modo teste ligado. Desde 10/11/2026 o cliente real também
  // passa (em homologação, para a conversa de teste).
  // Desde 10/11/2026 o aviso de produção sai para o cliente real: sem o "em ajuste".
  assert.doesNotThrow(() => conferirEnvioProducao(false, 14));
  assert.doesNotThrow(() => conferirEnvioProducao(false, 70130));
  assert.doesNotThrow(() => conferirEnvioProducao(true, 70130));
  assert.doesNotThrow(() => conferirEnvioProducao(true, 14));
  // Link: exatamente uma linha ativa do próprio pedido.
  // Só o final do link, como o Imposition grava (o template tem o começo fixo).
  assert.equal(linkDoCliente(24917, [{ numero_pedido: "24917", token: "ab12cd" }]), "24917-ab12cd");
  assert.equal(linkDoCliente(24880, [{ numero_pedido: 24880, token: " 30b9b9 " }]), "24880-30b9b9");
  assert.ok(!linkDoCliente(24917, [{ numero_pedido: "24917", token: "ab12cd" }]).includes("/"));
  assert.throws(() => linkDoCliente(24917, []), /Pedido sem link de aprovação/);
  assert.throws(() => linkDoCliente(24917, null), /Pedido sem link de aprovação/);
  assert.throws(() => linkDoCliente(24917, [{ numero_pedido: "24880", token: "ab12cd" }]), /sem link/);
  assert.throws(() => linkDoCliente(24917, [{ numero_pedido: "24917", token: "ab" }]), /sem link/);
  assert.throws(() => linkDoCliente(24917, [{ numero_pedido: "24917", token: "ab12cd" }, { numero_pedido: "24917", token: "xy34ef" }]), /sem link/);
  assert.equal(SEM_LINK_APROVACAO, "Pedido sem link de aprovação");
  assert.equal(AVISO_PRODUCAO_EM_AJUSTE, "Envio de aviso de produção em ajuste");
});

caso("N. regra dos 120 s do ChatGuru", () => {
  const r = { code: 200, dialog_execution_return: "Diálogo não foi executado pois o tempo mínimo não foi atingido: Tempo decorrido: 63 segs - Mínimo: 120 segs", result: "error" };
  assert.equal(recusaTempoMinimo(r), true);
  // Recusa explícita: estado 'falhou' (libera a conversa), não 'desconhecido'.
  assert.equal(envioRecusado(200, r), true);
  assert.equal(dialogoExecutado(200, r), false);
  assert.equal(TEMPO_MINIMO_GURU, "O ChatGuru exige 2 minutos entre mensagens para a mesma conversa. Tente de novo em instantes.");
  // Não confunde com sucesso nem com outra resposta.
  assert.equal(recusaTempoMinimo({ code: 200, dialog_execution_return: "Diálogo Executado", result: "success" }), false);
  assert.equal(envioRecusado(200, { code: 200, result: "error", description: "algo inesperado" }), false);
  assert.equal(envioRecusado(500, r), false);
});

caso("O. v19: pausa dos avisos", () => {
  assert.equal(avisosPausados(undefined), false);
  assert.equal(avisosPausados(""), false);
  assert.equal(avisosPausados("  "), false);
  assert.equal(avisosPausados("desligada"), false);
  assert.equal(avisosPausados(" Desligada "), false);
  assert.equal(avisosPausados("ligada"), true);
  assert.equal(avisosPausados("LIGADA"), true);
  // Erro de digitação pausa: na dúvida, não envia.
  assert.equal(avisosPausados("ligado"), true);
  assert.equal(avisosPausados("desligado"), true);
  assert.throws(() => conferirPausa("ligada"), (e: any) => e.status === 423 && e.message === AVISOS_PAUSADOS);
  assert.doesNotThrow(() => conferirPausa(undefined));
  assert.equal(AVISOS_PAUSADOS, "Envio de avisos pausado por alguns minutos. Tente de novo em instantes.");
});

caso("P. v19: trava compartilhada", () => {
  // Chave no formato que o banco aceita (check e gatilho da migração).
  assert.equal(chaveDaTrava("0E8F1C2A-1234-4abc-8def-0123456789ab"), "vibe:0e8f1c2a-1234-4abc-8def-0123456789ab");
  assert.match(chaveDaTrava("00000000-0000-4000-8000-0000000000a3"), /^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.throws(() => chaveDaTrava("nao-uuid"), (e: any) => e.message === TRAVA_INDISPONIVEL);
  assert.throws(() => chaveDaTrava(""), /indisponível/);
  // Só "reservado" deixa enviar; erro ou resposta estranha = indisponível (nada sai).
  assert.equal(resultadoTrava("reservado", null), "reservado");
  assert.equal(resultadoTrava("ocupado", null), "ocupado");
  assert.equal(resultadoTrava(null, { code: "PGRST202", message: "Could not find the function" }), "indisponivel");
  assert.equal(resultadoTrava("reservado", { code: "57014" }), "indisponivel");
  assert.equal(resultadoTrava(null, null), "indisponivel");
  assert.equal(resultadoTrava("RESERVADO", null), "indisponivel");
  // Soltar: executado com margem, falhou sem margem, desconhecido e preparando não soltam.
  assert.deepEqual(comoSoltar("executado"), { soltar: true, executado: true });
  assert.deepEqual(comoSoltar("falhou"), { soltar: true, executado: false });
  assert.deepEqual(comoSoltar("desconhecido"), { soltar: false, executado: false });
  assert.deepEqual(comoSoltar("preparando"), { soltar: false, executado: false });
  assert.equal(TRAVA_OCUPADA, "Há uma operação pendente para esta conversa. Nada foi enviado. Tente de novo em instantes.");
  assert.equal(TRAVA_INDISPONIVEL, "Trava compartilhada indisponível. Nada foi enviado.");
});

caso("Q. v19: Liberar número da trava compartilhada presa", () => {
  const conversa = "a".repeat(64);
  // Só aviso terminado e com conversa pode ter deixado a trava presa.
  assert.equal(podeTerTravaPresa({ estado: "executado", destino_chave: conversa }), true);
  assert.equal(podeTerTravaPresa({ estado: "falhou", destino_chave: conversa }), true);
  assert.equal(podeTerTravaPresa({ estado: "desconhecido", destino_chave: conversa }), false);
  assert.equal(podeTerTravaPresa({ estado: "preparando", destino_chave: conversa }), false);
  assert.equal(podeTerTravaPresa({ estado: "executado", destino_chave: null }), false);
  // Modo: só "trava" explícito; o resto é a conferência de sempre (exige resposta).
  assert.equal(modoDaLiberacao({ modo: "trava" }), "trava");
  assert.equal(modoDaLiberacao({ modo: "TRAVA" }), "conferir");
  assert.equal(modoDaLiberacao({ resposta: "enviada" }), "conferir");
  assert.equal(modoDaLiberacao(null), "conferir");
  // A chave solta é sempre a do próprio aviso, com 'vibe:': nunca a de um envio de
  // arte (64 hex), que nem passa pela conversão.
  assert.match(chaveDaTrava("00000000-0000-4000-8000-0000000000a3"), /^vibe:/);
  assert.throws(() => chaveDaTrava("b".repeat(64)), /indisponível/);
  assert.equal(TRAVA_NAO_PRESA, "A conversa deste aviso não está presa. Atualize a tela.");
  assert.equal(TRAVA_NAO_SOLTA, "Não foi possível soltar a conversa. Nada mudou. Tente de novo.");
});

caso("R. modo homologação", () => {
  // Só com o modo teste ligado e pedido fora do cliente #14.
  assert.equal(emHomologacao(true, 70130), true);
  assert.equal(emHomologacao(true, "70130"), true);
  assert.equal(emHomologacao(true, 14), false);
  assert.equal(emHomologacao(false, 70130), false);
  assert.equal(emHomologacao(false, 14), false);
  // Conversa de teste: a única do cliente #14, ou a única com o nome dela.
  const edison = { chat_id: "6071ddf6861416b62a289286", nome: CONVERSA_TESTE_NOME, numero: "555184608848" };
  const outra = { chat_id: "x1", nome: "Outra - 14", numero: "5551999999999" };
  assert.deepEqual(conversaDeTeste([edison]), edison);
  assert.deepEqual(conversaDeTeste([outra, edison]), edison);
  assert.throws(() => conversaDeTeste([]), /Conversa de teste do cliente #14 não encontrada/);
  assert.throws(() => conversaDeTeste([outra, { ...outra, chat_id: "x2" }]), /não encontrada/);
  // Regra dos 2 minutos: em andamento ou executado há menos de 120 s.
  const agora = Date.parse("2026-11-10T15:00:00Z");
  assert.equal(INTERVALO_GURU_MS, 120000);
  assert.equal(conversaTesteOcupada({ emAndamento: true, ultimoExecutadoEm: null, agoraMs: agora }), true);
  assert.equal(conversaTesteOcupada({ emAndamento: false, ultimoExecutadoEm: null, agoraMs: agora }), false);
  assert.equal(conversaTesteOcupada({ emAndamento: false, ultimoExecutadoEm: "2026-11-10T14:58:01Z", agoraMs: agora }), true);
  assert.equal(conversaTesteOcupada({ emAndamento: false, ultimoExecutadoEm: "2026-11-10T14:58:00Z", agoraMs: agora }), false);
  assert.equal(conversaTesteOcupada({ emAndamento: false, ultimoExecutadoEm: "lixo", agoraMs: agora }), false);
  assert.equal(CONVERSA_TESTE_OCUPADA, "Conversa de teste ocupada, tente em 2 minutos.");
  assert.equal(TEXTO_HOMOLOGACAO, "Modo homologação: a mensagem vai para a conversa de teste do Edison, não para o cliente.");
  assert.match(SEM_CONVERSA_TESTE, /Nada foi enviado/);
});

console.log(`\n${n} casos ok`);
