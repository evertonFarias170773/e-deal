/**
 * Reenvio de pedido devolvido, fase 1 — o lado da tela (src/features/expedicao/lib/reenvio.ts).
 *
 * Quem decide e o banco (exp_reenviar_pedido, migration 20261022_exp_reenvio_fase1.sql);
 * aqui so o estado "reenvio aberto", o item do menu, os avisos e o texto do erro. NAO TOCA EM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/reenvio.test.mts
 */
import {
  agruparReenvios,
  avisosDoReenvio,
  chaveDoReenvio,
  podeOferecerReenvio,
  reenvioDoPedido,
  textoDoErroDeReenvio,
  type LinhaReenvio
} from "../../src/features/expedicao/lib/reenvio.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// Formatos reais: o PostgREST devolve timestamptz com fuso; a data copiada e a mesma coluna.
const DESPACHO_1 = "2026-10-22T11:54:51.652+00:00";
const linha = (ciclo: number, dataAnterior: string): LinhaReenvio => ({
  id_int: 23820,
  ciclo,
  motivo: `Devolvido ${ciclo}`,
  autor_nome: "userteste1",
  criado_em: "2026-10-22T15:00:00+00:00",
  tipo_frete_anterior: "CORREIOS",
  tipo_frete_novo: "CORREIOS",
  data_despacho_anterior: dataAnterior
});

checar("sem linhas: sem reenvio", reenvioDoPedido([], DESPACHO_1), null);
checar("aberto: data de despacho e a copiada", reenvioDoPedido([linha(1, DESPACHO_1)], DESPACHO_1)?.aberto?.ciclo, 1);
checar("aberto mesmo com outro formato do mesmo instante", reenvioDoPedido([linha(1, DESPACHO_1)], "2026-10-22 11:54:51.652+00")?.aberto?.ciclo, 1);
checar("fechado: redespachado (data nova)", reenvioDoPedido([linha(1, DESPACHO_1)], "2026-10-23T09:00:00+00:00"), { ciclos: 1, aberto: null });
checar("fechado: data de despacho apagada (Voltar status)", reenvioDoPedido([linha(1, DESPACHO_1)], null)?.aberto, null);
checar(
  "dois ciclos: vale o ultimo",
  reenvioDoPedido([linha(1, "2026-10-01T10:00:00+00:00"), linha(2, DESPACHO_1)], DESPACHO_1)?.aberto?.ciclo,
  2
);
checar("dois ciclos: proximo e o 3", (reenvioDoPedido([linha(2, DESPACHO_1), linha(1, "2026-10-01T10:00:00+00:00")], "x")?.ciclos ?? 0) + 1, 3);
checar("agrupar por pedido", [...agruparReenvios([linha(1, DESPACHO_1), { ...linha(1, DESPACHO_1), id_int: "24000" }]).keys()], [23820, 24000]);

const base = { statusInterno: "EM TRANSITO", despachoConfirmado: true, dataEntrega: null, pedidoPrincipal: null, complementos: [] as unknown[] };
checar("item: EM TRANSITO despachado", podeOferecerReenvio(base), true);
checar("item: fora de EM TRANSITO", podeOferecerReenvio({ ...base, statusInterno: "ENTREGUE" }), false);
checar("item: sem despacho", podeOferecerReenvio({ ...base, despachoConfirmado: false }), false);
checar("item: com data de entrega", podeOferecerReenvio({ ...base, dataEntrega: "2026-10-22T10:00:00Z" }), false);
checar("item: complemento", podeOferecerReenvio({ ...base, pedidoPrincipal: { idInt: 1 } }), false);
checar("item: principal com complemento", podeOferecerReenvio({ ...base, complementos: [{}] }), false);

checar("chave do banco", chaveDoReenvio(23820, 2), "REENVIO:23820:2");

const avisosCorreios = avisosDoReenvio({ tipoFreteAtual: "CORREIOS", correiosCodigoObjeto: "AE058913117BR", prepostagemCanceladaEm: null, azulAwb: null });
checar("aviso Correios cita o objeto antigo", avisosCorreios.length === 1 && avisosCorreios[0].includes("AE058913117BR"), true);
checar("sem aviso Correios com prepostagem ja cancelada", avisosDoReenvio({ tipoFreteAtual: "CORREIOS", correiosCodigoObjeto: "AE1BR", prepostagemCanceladaEm: "2026-10-22", azulAwb: null }), []);
const avisoAzul = avisosDoReenvio({ tipoFreteAtual: "TRANSPORTADORA", correiosCodigoObjeto: null, prepostagemCanceladaEm: null, azulAwb: "123" });
checar("aviso Azul: uma AWB por pedido", avisoAzul.length === 1 && avisoAzul[0].includes("123"), true);

// Textos reais devolvidos pela RPC na prova de 22/10/2026 (transacao desfeita).
checar(
  "erro de frete sem o codigo",
  textoDoErroDeReenvio("EXP_REENVIO_FRETE: este endereco ou tipo de envio exige recotar o frete. A diferenca de frete no reenvio sera tratada na fase 2; nada foi gravado."),
  "este endereco ou tipo de envio exige recotar o frete. A diferenca de frete no reenvio sera tratada na fase 2; nada foi gravado."
);
checar("erro de permissao em portugues", textoDoErroDeReenvio("PERM: sem permissão expedicao.reenvio"), "Você não tem a permissão de reenviar pedido (expedicao.reenvio).");

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
