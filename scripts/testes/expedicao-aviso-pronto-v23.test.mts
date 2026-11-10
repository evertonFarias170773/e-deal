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
 *      retirada, motoboy e transportadora pelo que está na tela.
 */
import assert from "node:assert/strict";
import {
  SEM_ETIQUETA,
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

console.log(`\n${n} casos ok`);
