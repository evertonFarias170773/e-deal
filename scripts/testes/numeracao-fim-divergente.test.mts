/**
 * Nº Final gravado × calculado — src/features/orcamentos/numeracao-modelo-utils.ts
 *
 *   node --experimental-strip-types scripts/testes/numeracao-fim-divergente.test.mts
 *
 * Caso real (pedido 23161, lido em 09/10/2026): modelo de 400 un com o
 * numerador "Ticket 4" (4 numerações por unidade) gravado com 1–800; a conta de
 * hoje dá 1–1600. Os outros 4 modelos do pedido (100 un, tipo nulo, "001 -
 * Padrão Ideal", 1–100) estão certos.
 *
 * O QUE PROVA
 *   1. 400 × 4 gravado 800 gera aviso; gravado 1600 não.
 *   2. Os 4 modelos de 100 não geram aviso; tipo nulo não atrapalha.
 *   3. Sem falso alarme: sem numerador, numerador fora da lista, lista vazia,
 *      SEM_NUMERACAO, Mapa de Teatro, sem faixa, ticket sem quantidade.
 *   4. "Sequencial entre os modelos": compara o Nº Inicial GRAVADO.
 *   5. A pergunta antes de imprimir e a lista quando o numerador muda.
 */
import {
  avisoDoFimDivergente,
  calcularNumeracaoFim,
  divergenciaDoFim,
  fimCalculadoDoGravado,
  modelosComFimDivergente,
  pedidosAReabrirPeloNumerador,
  perguntaAntesDeImprimir,
  resolverMultiplicadorNumeracao
} from "../../src/features/orcamentos/numeracao-modelo-utils.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

const NUMERACOES = [
  { name: "001 - Padrão Ideal", tipo: "SEQUENCIAL", ticket_qtd: 1 },
  { name: "Ticket 2", tipo: "TICKET", ticket_qtd: 2 },
  { name: "Ticket 4", tipo: "TICKET", ticket_qtd: 4 },
  { name: "Ticket quebrado", tipo: "TICKET", ticket_qtd: null }
];
const lavanda400 = { id: 1002392, id_int: 23161, nome_modelo: "LAVANDA", quantidade: 400, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 800, gabarito_operacional: "Ticket 4" };
const lavanda100 = (id: number) => ({ id, id_int: 23161, nome_modelo: "LAVANDA", quantidade: 100, tipo_numeracao: null, numeracao_inicio: 1, numeracao_fim: 100, gabarito_operacional: "001 - Padrão Ideal" });

/* 1. O caso do 23161 */
checar("23161: a conta de hoje da 1600", fimCalculadoDoGravado(lavanda400, NUMERACOES), 1600);
checar("23161: gravado 800 gera divergencia", divergenciaDoFim(lavanda400, NUMERACOES), { id: 1002392, idInt: 23161, nome: "LAVANDA", numerador: "Ticket 4", gravado: 800, calculado: 1600 });
checar("23161: o texto do aviso", avisoDoFimDivergente({ gravado: 800, calculado: 1600 }), "Nº final gravado (800) difere do calculado (1600). Salve para corrigir antes de imprimir.");
checar("gravado 1600: sem aviso", divergenciaDoFim({ ...lavanda400, numeracao_fim: 1600 }, NUMERACOES), null);
checar("a conta e a mesma da tela", fimCalculadoDoGravado(lavanda400, NUMERACOES), calcularNumeracaoFim(1, 400, resolverMultiplicadorNumeracao(NUMERACOES[2]).multiplicador));
checar("com o numerador ainda em 2 por unidade, 800 estava certo", divergenciaDoFim(lavanda400, [{ name: "Ticket 4", tipo: "TICKET", ticket_qtd: 2 }]), null);

/* 2. Os 4 modelos de 100, tipo nulo */
checar("os 4 modelos de 100 (tipo nulo, 1-100): sem aviso", [1002091, 1002092, 1002093, 1002094].map((id) => divergenciaDoFim(lavanda100(id), NUMERACOES)), [null, null, null, null]);
checar("o pedido inteiro: so o modelo de 400 diverge", modelosComFimDivergente([...[1002091, 1002092, 1002093, 1002094].map(lavanda100), lavanda400], NUMERACOES).map((d) => d.id), [1002392]);

/* 3. Sem falso alarme */
checar("lista de numeradores ainda nao carregada: nao confere", divergenciaDoFim(lavanda400, []), null);
checar("modelo sem numerador: nao confere", divergenciaDoFim({ ...lavanda400, gabarito_operacional: null }, NUMERACOES), null);
checar("numerador fora da lista (exclusivo de outro cliente, apagado): nao confere", divergenciaDoFim({ ...lavanda400, gabarito_operacional: "Numerador que sumiu" }, NUMERACOES), null);
checar("SEM_NUMERACAO: nao confere", divergenciaDoFim({ ...lavanda400, tipo_numeracao: "SEM_NUMERACAO" }, NUMERACOES), null);
checar("setor de Mapa de Teatro: nao confere", [divergenciaDoFim({ ...lavanda400, mapa_teatro_setor_id: "s1" }, NUMERACOES), divergenciaDoFim({ ...lavanda400, mapa_teatro_id: "11111111-1111-4111-8111-111111111111" }, NUMERACOES)], [null, null]);
checar("sem Nº inicial, sem Nº final ou sem quantidade: nao confere", [divergenciaDoFim({ ...lavanda400, numeracao_inicio: null }, NUMERACOES), divergenciaDoFim({ ...lavanda400, numeracao_fim: null }, NUMERACOES), divergenciaDoFim({ ...lavanda400, quantidade: 0 }, NUMERACOES), divergenciaDoFim({ ...lavanda400, quantidade: null }, NUMERACOES)], [null, null, null, null]);
checar("ticket sem quantidade por unidade valida: nao confere", divergenciaDoFim({ ...lavanda400, gabarito_operacional: "Ticket quebrado" }, NUMERACOES), null);
checar("numero vindo como texto do banco (bigint): compara pelo valor", [divergenciaDoFim({ ...lavanda400, numeracao_inicio: "1", numeracao_fim: "1600", quantidade: "400" }, NUMERACOES), divergenciaDoFim({ ...lavanda400, numeracao_fim: "800" }, NUMERACOES)?.gravado], [null, 800]);

/* 4. Sequencial entre os modelos: vale o Nº inicial gravado */
const sequenciais = [
  { id: 1, id_int: 900, nome_modelo: "A", quantidade: 300, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 300, gabarito_operacional: "001 - Padrão Ideal" },
  { id: 2, id_int: 900, nome_modelo: "B", quantidade: 150, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 301, numeracao_fim: 450, gabarito_operacional: "001 - Padrão Ideal" },
  { id: 3, id_int: 900, nome_modelo: "C", quantidade: 80, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 451, numeracao_fim: 530, gabarito_operacional: "001 - Padrão Ideal" }
];
checar("Sequencial entre os modelos (1-300, 301-450, 451-530): sem aviso", modelosComFimDivergente(sequenciais, NUMERACOES), []);
checar("Sequencial com ticket de 2: 1-600 e 601-900 conferem", modelosComFimDivergente([{ ...sequenciais[0], numeracao_fim: 600, gabarito_operacional: "Ticket 2" }, { ...sequenciais[1], numeracao_inicio: 601, numeracao_fim: 900, gabarito_operacional: "Ticket 2" }], NUMERACOES), []);
checar("Sequencial com um fim velho no meio: so ele avisa", modelosComFimDivergente([sequenciais[0], { ...sequenciais[1], numeracao_fim: 400 }, sequenciais[2]], NUMERACOES).map((d) => [d.id, d.gravado, d.calculado]), [[2, 400, 450]]);
checar("Cada modelo comeca do 1 (1-300, 1-150): sem aviso", modelosComFimDivergente([sequenciais[0], { ...sequenciais[1], numeracao_inicio: 1, numeracao_fim: 150 }], NUMERACOES), []);

/* 5. A pergunta antes de imprimir */
checar("sem divergencia: nao ha pergunta (imprime direto)", perguntaAntesDeImprimir([]), "");
{
  const pergunta = perguntaAntesDeImprimir(modelosComFimDivergente([lavanda400], NUMERACOES));
  checar("a pergunta cita o modelo, os dois numeros e pede confirmacao", [pergunta.includes("#1002392 LAVANDA: gravado 800, calculado 1600 (Ticket 4)"), pergunta.includes("O documento sai com o número GRAVADO"), pergunta.trim().endsWith("Imprimir mesmo assim?"), pergunta.split(String.fromCharCode(10)).length > 4], [true, true, true, true]);
}
checar("muitos modelos: lista os 8 primeiros e diz quantos faltam", perguntaAntesDeImprimir(Array.from({ length: 11 }, (_, i) => ({ id: i + 1, idInt: 1, nome: "M", numerador: "Ticket 4", gravado: 800, calculado: 1600 }))).includes("e mais 3"), true);

/* 6. Numerador alterado: a lista de pedidos a reabrir */
{
  const usamOTicket4 = [
    lavanda400,
    { id: 2001, id_int: 23500, nome_modelo: "X", quantidade: 100, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 200, gabarito_operacional: "Ticket 4" },
    { id: 2002, id_int: 23500, nome_modelo: "Y", quantidade: 50, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 201, numeracao_fim: 300, gabarito_operacional: "Ticket 4" },
    { id: 2003, id_int: 23600, nome_modelo: "Z", quantidade: 10, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 40, gabarito_operacional: "Ticket 4" },
    { id: 2004, id_int: 23700, nome_modelo: "W", quantidade: 10, tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 10, gabarito_operacional: "001 - Padrão Ideal" }
  ];
  const r = pedidosAReabrirPeloNumerador(usamOTicket4, { name: "Ticket 4", tipo: "TICKET", ticket_qtd: 4 });
  checar("numerador passou de 2 para 4: lista os pedidos gravados com a conta antiga", [r.texto, r.pedidos, r.modelos.map((m) => m.id)], ["Estes pedidos precisam ser reabertos e salvos", [23161, 23500], [1002392, 2001, 2002]]);
  checar("o modelo que ja estava certo e o de outro numerador ficam fora", r.modelos.some((m) => m.id === 2003 || m.id === 2004), false);
  checar("numerador que nao mudou a conta: lista vazia e sem texto", pedidosAReabrirPeloNumerador([usamOTicket4[3]], { name: "Ticket 4", tipo: "TICKET", ticket_qtd: 4 }), { texto: "", pedidos: [], modelos: [] });
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
