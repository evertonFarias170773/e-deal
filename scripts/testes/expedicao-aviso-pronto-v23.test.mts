/**
 * Aviso "pedido pronto" v23 (10/11/2026): o aviso sai no "Confirmar despacho".
 * Regras puras da versão no ar, supabase/edge-no-ar/expedicao-pedido-pronto/logica.ts.
 *
 *   node --experimental-strip-types scripts/testes/expedicao-aviso-pronto-v23.test.mts
 *
 * SEM rede e SEM banco.
 *   A. status: EXPEDICAO, A RETIRAR e EM TRANSITO aceitam; o resto recusa;
 *   B. despacho da tela ("preparar"): só texto curto, id inteiro, endereço uuid;
 *   C. o modelo da janela pela forma de envio da tela: SEDEX sem rastreio fica
 *      "Gere a etiqueta dos Correios antes."; com rastreio, Sedex; PAC sem modelo;
 *      retirada, motoboy e transportadora pelo que está na tela;
 *   D. v24: conversa escolhida na aba Artes vale só se ainda é do cliente;
 *   E. v25: Azul pelo cadastro 808 (SVT, sem AZUL no nome), no despacho e no
 *      orçamento; outra transportadora continua Transportadora;
 *   F. v26: campo Transportadora (nome curto pela lista, despacho vence orçamento,
 *      só no diálogo Transportadora) e #arte só no link do Colocando em Produção.
 */
import assert from "node:assert/strict";
import {
  SEM_ETIQUETA,
  SEM_TRANSPORTADORA,
  camposDoDialogo,
  conversaDaProposta,
  linkDoAvisoProducao,
  linkDoCliente,
  nomeCurtoTransportadora,
  transportadoraDoAviso,
  SEM_MODELO,
  STATUS_AVISO_PRONTO,
  despachoDaTela,
  escolherDialogo,
  rastreioCorreiosValido,
  statusPermiteAvisoPronto
} from "../../supabase/edge-no-ar/expedicao-pedido-pronto/logica.ts";

let n = 0;
function caso(nome: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok - ${nome}`);
}

caso("A. status do aviso de pedido pronto", () => {
  assert.deepEqual([...STATUS_AVISO_PRONTO], ["EXPEDICAO", "A RETIRAR", "EM TRANSITO"]);
  for (const s of ["EXPEDICAO", "A RETIRAR", "EM TRANSITO", " em transito ", "a retirar"]) assert.equal(statusPermiteAvisoPronto(s), true, s);
  for (const s of ["ENTREGUE", "CANCELADO", "EM ACABAMENTO", "APROVADO", "", null, undefined]) assert.equal(statusPermiteAvisoPronto(s), false, String(s));
});

caso("B. despacho da tela", () => {
  assert.equal(despachoDaTela(null), null);
  assert.equal(despachoDaTela("x"), null);
  const t = despachoDaTela({
    tipo_frete: " CORREIOS ",
    modalidade_frete: "CIF",
    transportadora_nome: "Correios SEDEX",
    id_transportadora_cliente: "12",
    rastreio: " AB123456789BR ",
    id_endereco_entrega: "0f8fad5b-d9cb-469f-a165-70867728950e"
  });
  assert.deepEqual(t, {
    despacho: {
      tipo_frete: "CORREIOS",
      modalidade_frete: "CIF",
      categoria_frete: null,
      transportadora_nome: "Correios SEDEX",
      id_transportadora_cliente: 12
    },
    rastreio: "AB123456789BR",
    idEnderecoEntrega: "0f8fad5b-d9cb-469f-a165-70867728950e"
  });
  const lixo = despachoDaTela({ tipo_frete: 5, id_transportadora_cliente: -3, id_endereco_entrega: "1; drop" });
  assert.equal(lixo?.despacho.tipo_frete, null);
  assert.equal(lixo?.despacho.id_transportadora_cliente, null);
  assert.equal(lixo?.idEnderecoEntrega, null);
});

caso("C. modelo pela forma de envio da tela", () => {
  const orcamento = { modalidade_frete: "CIF", servicoCotacao: "SEDEX" };
  const sedex = { tipo_frete: "CORREIOS", modalidade_frete: "CIF", transportadora_nome: "Correios SEDEX" };
  // Sem prepostagem nem rastreio digitado: o despacho passa, o aviso não.
  assert.deepEqual(escolherDialogo({ despacho: sedex, orcamento, rastreioCorreios: rastreioCorreiosValido(null, "") }), {
    dialogo: "Sedex",
    bloqueio: SEM_ETIQUETA,
    origem: "despacho"
  });
  // Número de transportadora no campo não é rastreio dos Correios.
  assert.equal(rastreioCorreiosValido(null, "123456"), null);
  assert.deepEqual(escolherDialogo({ despacho: sedex, orcamento, rastreioCorreios: rastreioCorreiosValido(null, "AB123456789BR") }), {
    dialogo: "Sedex",
    bloqueio: null,
    origem: "despacho"
  });
  assert.equal(
    escolherDialogo({ despacho: { ...sedex, transportadora_nome: "Correios PAC" }, orcamento, rastreioCorreios: "AB123456789BR" }).bloqueio,
    SEM_MODELO
  );
  assert.equal(escolherDialogo({ despacho: { tipo_frete: "RETIRA_BALCAO" }, orcamento, rastreioCorreios: null }).dialogo, "Retira");
  assert.equal(escolherDialogo({ despacho: { tipo_frete: "MOTOBOY" }, orcamento, rastreioCorreios: null }).dialogo, "Motoboy");
  assert.equal(
    escolherDialogo({ despacho: { tipo_frete: "TRANSPORTADORA", transportadora_nome: "Rodonaves" }, orcamento, rastreioCorreios: null }).dialogo,
    "Transportadora"
  );
});

caso("D. v24: conversa escolhida na aba Artes", () => {
  const lista = [
    { chat_id: "a1", nome: "Cliente - 25847", numero: "5551991010423" },
    { chat_id: "b2", nome: "Financeiro - 25847", numero: "5551984608848" }
  ];
  assert.equal(conversaDaProposta("b2", lista)?.chat_id, "b2");
  assert.equal(conversaDaProposta(" a1 ", lista)?.chat_id, "a1");
  assert.equal(conversaDaProposta("zz", lista), null);
  assert.equal(conversaDaProposta(null, lista), null);
  assert.equal(conversaDaProposta("", lista), null);
});

caso("E. v25: Azul pelo cadastro 808", () => {
  // Entradas reais de expedicoes (11/11/2026): 25011 pela 808, 24952 pela São Miguel.
  const orcamentoVazio = {};
  const azul = {
    tipo_frete: "TRANSPORTADORA",
    modalidade_frete: "CIF",
    categoria_frete: "AEREO",
    transportadora_nome: "SVT TRANSPORTES",
    id_transportadora_cliente: 808
  };
  assert.deepEqual(escolherDialogo({ despacho: azul, orcamento: orcamentoVazio, rastreioCorreios: null }), {
    dialogo: "Azul",
    bloqueio: null,
    origem: "despacho"
  });
  assert.equal(
    escolherDialogo({ despacho: { ...azul, id_transportadora_cliente: "808" }, orcamento: orcamentoVazio, rastreioCorreios: null }).dialogo,
    "Azul"
  );
  const saoMiguel = {
    ...azul,
    categoria_frete: "RODOVIARIO",
    transportadora_nome: "EXPRESSO SAO MIGUEL S/A",
    id_transportadora_cliente: 120026
  };
  assert.equal(escolherDialogo({ despacho: saoMiguel, orcamento: orcamentoVazio, rastreioCorreios: null }).dialogo, "Transportadora");
  assert.equal(
    escolherDialogo({ despacho: { ...azul, id_transportadora_cliente: 4321 }, orcamento: orcamentoVazio, rastreioCorreios: null }).dialogo,
    "Transportadora"
  );
  // Orçamento (expedidor ainda não declarou): o mesmo pelo cadastro da proposta.
  const orc808 = {
    modalidade_frete: "CIF",
    categoria_frete: "AEREO",
    id_transportadora_cliente: 808,
    nomeTransportadora: "SVT PROVEDOR LOGISTICO LTDA",
    servicoCotacao: null
  };
  assert.equal(escolherDialogo({ despacho: null, orcamento: orc808, rastreioCorreios: null }).dialogo, "Azul");
  assert.equal(
    escolherDialogo({
      despacho: null,
      orcamento: { ...orc808, id_transportadora_cliente: 120026, nomeTransportadora: "EXPRESSO SAO MIGUEL S/A" },
      rastreioCorreios: null
    }).dialogo,
    "Transportadora"
  );
});

caso("F. v26: campo Transportadora e #arte", () => {
  // Lista aprovada (13/11/2026).
  assert.equal(nomeCurtoTransportadora(120026, "EXPRESSO SAO MIGUEL S/A"), "São Miguel");
  assert.equal(nomeCurtoTransportadora("120027", "EXPRESSO SAO MIGUEL S/A"), "São Miguel");
  assert.equal(nomeCurtoTransportadora(796, "TROCA TRANSPORTES LTDA"), "Troca");
  assert.equal(nomeCurtoTransportadora(120011, "BTU - BRASPRESS - CSJ"), "Braspress");
  assert.equal(nomeCurtoTransportadora(120006, "ECCOM"), "Avi Azul");
  // Fora da lista: a fantasia gravada.
  assert.equal(nomeCurtoTransportadora(4321, "  RODONAVES  "), "RODONAVES");
  assert.equal(nomeCurtoTransportadora(null, ""), null);

  // Despacho vence orçamento.
  const orcamento = {
    modalidade_frete: "CIF",
    categoria_frete: "RODOVIARIO",
    id_transportadora_cliente: 796,
    nomeTransportadora: "TROCA TRANSPORTES LTDA"
  };
  const despacho = {
    tipo_frete: "TRANSPORTADORA",
    modalidade_frete: "CIF",
    transportadora_nome: "EXPRESSO SAO MIGUEL S/A",
    id_transportadora_cliente: 120026
  };
  const e1 = { despacho, orcamento, rastreioCorreios: null };
  const c1 = escolherDialogo(e1);
  assert.equal(c1.dialogo, "Transportadora");
  assert.equal(transportadoraDoAviso(e1, c1), "São Miguel");
  const e2 = { despacho: null, orcamento, rastreioCorreios: null };
  assert.equal(transportadoraDoAviso(e2, escolherDialogo(e2)), "Troca");
  // Despacho sem nome nem id: cai no orçamento.
  const e3 = { despacho: { tipo_frete: "TRANSPORTADORA", transportadora_nome: "" }, orcamento, rastreioCorreios: null };
  assert.equal(transportadoraDoAviso(e3, escolherDialogo(e3)), "Troca");

  // Campo só no diálogo Transportadora; Veppo e Azul sem mudança.
  const v = { idInt: 24880, notaFiscal: "123", cidadeDestino: "Porto Alegre/RS", rastreio: null, transportadora: "São Miguel" };
  assert.deepEqual(camposDoDialogo("Transportadora", v), {
    field__Cidade_Destino: "Porto Alegre/RS",
    field__Pedido_Atual: "24880",
    field__Nota_Fiscal: "123",
    field__Transportadora: "São Miguel"
  });
  assert.deepEqual(Object.keys(camposDoDialogo("Azul", v)), ["field__Pedido_Atual", "field__Nota_Fiscal", "field__Cidade_Destino"]);
  assert.deepEqual(Object.keys(camposDoDialogo("Veppo", v)), ["field__Cidade_Destino", "field__Pedido_Atual", "field__Nota_Fiscal"]);
  assert.throws(() => camposDoDialogo("Transportadora", { ...v, transportadora: null }), { message: SEM_TRANSPORTADORA });

  // #arte só no aviso de produção; o final do link continua igual.
  const final = linkDoCliente(25220, [{ numero_pedido: 25220, token: "h42mny" }]);
  assert.equal(final, "25220-h42mny");
  assert.equal(linkDoAvisoProducao(final), "25220-h42mny#arte");
});

console.log(`\n${n} casos ok`);
