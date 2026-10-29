/**
 * Salvar corrige o Nº final da linha intocada SÓ em pedido que ainda não saiu
 * (29/10/2026). O status é o lido do banco no próprio Salvar: no caminho
 * completo, a leitura do gate (`propostas.status_interno`); no parcial com
 * cobrança, o que o editar-paga leu e passou em `statusDoBanco`.
 *
 * Prova pelo `saveProposta` de verdade, com o cliente FALSO (nada é gravado):
 *   - ENTREGUE, EM TRANSITO e CANCELADO: a linha com 4000 sai com 4000;
 *   - EM PRODUCAO e NOVO: sai com 20000 (Ticket PRATA, QTD 4000, inicial 1);
 *   - status do banco ilegível ou ausente: sai como está;
 *   - linha ALTERADA pela pessoa é conferida em qualquer status.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/numeracao-fim-salvar-status.test.mts
 */
import { falso, getSupabaseClient } from "./_supabase-falso.mts";
import { saveProposta } from "../../src/features/orcamentos/services/orcamentos.service.ts";
import type { PropostaFormState } from "../../src/features/orcamentos/types.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(ok ? `ok      ${nome}` : `FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = getSupabaseClient() as any;
const ID_INT = 99003;

// O modelo do 24420 como estava gravado: Ticket PRATA, QTD 4000, 1-4000.
const GRAVADO = { id: 700, quantidade: 4000, numeracao_inicio: 1, gabarito_operacional: "Ticket PRATA" };
const modelo = (extra: Record<string, unknown> = {}) => ({
  id: 700, isPersisted: true, id_produto_proposta_origem: 11, nome_modelo: "VALE 01 REFEIÇÃO", padrao: "Branca",
  quantidade: 4000, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 4000, gabarito_operacional: "Ticket PRATA",
  ...extra
});
const formCom = (m: Record<string, unknown>, status: string) => ({
  id_int: String(ID_INT), status, observacoes: "obs", obsTecnica: "", obsEntrega: "", isAvulso: false,
  clienteId: "1", cliente: "Cliente", clienteNome: "Cliente", vendedor: "Vendedor", empresa: "1", contatoId: "1", compradorId: "1",
  enderecoId: "1", cepLivre: "01001000", freteEscolhidoId: "1", modalidadeFrete: "RETIRA", descontoGeralValor: 0, descontoGeralTipo: "VALOR",
  deletedProdutoPropostaIds: [], deletedModeloIds: [], fretes: [],
  itens: [{ id: "item_11", id_produto_proposta_origem: 11, id_produto: 301, nome: "Ticket", quantidade: 4000, valorUnitario: 1,
    produto: { peso: 0, ncm: "", cfop_interno: "" }, subtotal: 4000, subtotalBruto: 4000, acrescimoBonus: 0, pesoTotal: 0, variacoesEscolhidas: [] }],
  pedidosModelos: [m]
}) as unknown as PropostaFormState;

function combinar(caminho: "completo" | "parcial", statusNoBanco: string | null, gateFalha = false) {
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: caminho === "parcial" ? [{ id: "c1", status: "A_RECEBER" }] : [], error: null });
  falso.responder("produto_boletim_campos:select", { data: [], error: null });
  falso.responder("pedidos_modelos:select", { data: [GRAVADO], error: null });
  falso.responder("producao_numeracoes:select", { data: [{ name: "Ticket PRATA", tipo: "TICKET", ticket_qtd: 5 }], error: null });
  falso.responder("clientes:select", { data: [{ id_cliente: 1, id: 1, nome: "Cliente", tipo_contribuinte: "9", ativo: true }], error: null });
  falso.responder("produtos_proposta:select", { data: [{ id: 11, id_int: ID_INT, id_produto: 301 }], error: null });
  falso.responder("propostas:select", gateFalha
    ? { data: null, error: { message: "timeout" } }
    : { data: { status_interno: statusNoBanco, modalidade_frete: "RETIRA", id_transportadora_cliente: null, valor_frete: 0 }, error: null });
}

const fimGravado = (id = 700) => {
  const up = falso.chamadas.find((c) => c.tabela === "pedidos_modelos" && c.op === "update" &&
    c.filtros.some(([f, a]) => f === "eq" && (a as unknown[])[0] === "id" && (a as unknown[])[1] === id));
  return (up?.payload as Record<string, unknown> | undefined)?.numeracao_fim;
};

async function salvar(caminho: "completo" | "parcial", statusNoBanco: string | null, m: Record<string, unknown>, statusNaTela = "EM PRODUCAO", gateFalha = false) {
  combinar(caminho, statusNoBanco, gateFalha);
  const form = formCom(m, statusNaTela);
  return caminho === "completo"
    ? saveProposta(form, cliente, "usuario-de-teste", { force: true })
    : saveProposta(form, cliente, "usuario-de-teste", { gravarLotesComCobranca: true, statusDoBanco: statusNoBanco });
}

for (const caminho of ["completo", "parcial"] as const) {
  console.log(`\n── caminho ${caminho} (${caminho === "completo" ? "proposta paga/sem cobrança: status do gate" : "cobrança ativa via editar-paga: statusDoBanco"}) ──`);
  for (const [status, esperado] of [["ENTREGUE", 4000], ["CANCELADO", 4000], ["EM TRANSITO", 4000], ["EM PRODUCAO", 20000], ["NOVO", 20000]] as const) {
    const r = await salvar(caminho, status, modelo());
    checar(`${status}: linha intocada com 4000 sai com ${esperado}`, [r.success, fimGravado()], [true, esperado]);
  }
  // O status que vale é o do banco, não o da tela.
  const telaMente = await salvar(caminho, "ENTREGUE", modelo(), "EM PRODUCAO");
  checar("tela diz EM PRODUCAO, banco diz ENTREGUE: sai com 4000", [telaMente.success, fimGravado()], [true, 4000]);
  const semStatus = await salvar(caminho, null, modelo());
  checar("status do banco ausente: sai como está (4000)", [semStatus.success, fimGravado()], [true, 4000]);

  // Linha ALTERADA pela pessoa: conferida em qualquer status.
  for (const status of ["ENTREGUE", "CANCELADO", "EM PRODUCAO"]) {
    const errada = await salvar(caminho, status, modelo({ quantidade: 3000, numeracao_fim: 4000 }));
    checar(`${status}: linha alterada com Nº final errado é recusada, nada gravado`,
      [errada.success, String(errada.errorMessage).includes("o cadastro dá 15000"), falso.chamadas.filter((c) => c.op !== "select").length], [false, true, 0]);
    const certa = await salvar(caminho, status, modelo({ quantidade: 3000, numeracao_fim: 15000 }));
    checar(`${status}: linha alterada com Nº final certo grava 15000`, [certa.success, fimGravado()], [true, 15000]);
  }
}

console.log("\n── caminho completo: leitura do status falhou ──");
const gateFalhou = await salvar("completo", "EM PRODUCAO", modelo(), "EM PRODUCAO", true);
checar("gate ilegível: não corrige (sai com 4000), mesmo com a tela em EM PRODUCAO", [gateFalhou.success, fimGravado()], [true, 4000]);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
