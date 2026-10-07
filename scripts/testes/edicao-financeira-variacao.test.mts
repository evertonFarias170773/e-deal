/**
 * A trava de edição com cobrança enviada × item com variação paga —
 * src/features/orcamentos/lib/edicao-financeira.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/edicao-financeira-variacao.test.mts
 *
 * A regra é pura (formulário × retrato do banco): não há cliente nem escrita.
 * Os três itens são os números reais lidos em 07/10/2026 (só leitura):
 *   23240 item 3225 — 150 × (1,560 + 0,900) + 0,00  = 369,00   (RETIRA, frete 0)
 *   23331 item 3303 — 450 × (1,700 + 0,900) + 20,00 = 1.190,00 (CIF, frete 56,27)
 *   23138 item 3130 —  32 × (1,700 + 2,200) + 20,00 = 144,80   (CIF, frete 74,85)
 * O banco guarda só a soma dos acréscimos; a divisão do 2,200 em duas variações
 * (1,300 + 0,900) é do teste.
 *
 * O QUE PROVA
 *   1. Sem mudança, os três passam (antes acusavam "valor unitário").
 *   2. Mudar preço, quantidade, valor fixo ou variação continua acionando.
 *   3. Arte e observação não acionam.
 *   4. Item sem acréscimo segue igual a hoje.
 *   5. Diferença menor que meio centavo não aciona.
 */
import { divergenciasFinanceiras, valorUnitarioCheioDoItem, type SnapshotFinanceiro } from "../../src/features/orcamentos/lib/edicao-financeira.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

type Caso = { pedido: number; item: number; qtd: number; base: number; extras: number[]; fixo: number; subtotal: number; frete: number; modalidade: string };
const CASOS: Caso[] = [
  { pedido: 23240, item: 3225, qtd: 150, base: 1.56, extras: [0.9], fixo: 0, subtotal: 369, frete: 0, modalidade: "RETIRA" },
  { pedido: 23331, item: 3303, qtd: 450, base: 1.7, extras: [0.9], fixo: 20, subtotal: 1190, frete: 56.27, modalidade: "CIF" },
  { pedido: 23138, item: 3130, qtd: 32, base: 1.7, extras: [1.3, 0.9], fixo: 20, subtotal: 144.8, frete: 74.85, modalidade: "CIF" }
];

const escolhas = (extras: number[]) => extras.map((v_extra, i) => ({ id: `v${i}`, id_variacao: i + 1, variacao: {}, tipo: { id: `t${i}`, v_extra } }));

/** O formulário como a tela manda ao salvar: `valorUnitario` é o preço BASE. */
function formulario(c: Caso, mudar: Record<string, unknown> = {}, mudarItem: Record<string, unknown> = {}) {
  return {
    isAvulso: false,
    modalidadeFrete: c.modalidade,
    descontoGeralTipo: "VALOR",
    descontoGeralValor: 0,
    fretes: [{ id: "f1", valor: c.frete }],
    freteEscolhidoId: "f1",
    deletedProdutoPropostaIds: [],
    observacoes: "",
    itens: [
      {
        id: `item_${c.item}`, id_produto_proposta_origem: c.item, id_produto: 3001, nome: "Cordão 85cm", quantidade: c.qtd,
        valorUnitario: c.base, valorFixo: c.fixo, subtotal: c.subtotal, statusItem: "PENDENTE", variacoesEscolhidas: escolhas(c.extras), ...mudarItem
      }
    ],
    ...mudar
  } as never;
}

/** O retrato do banco: `valor_unt` já é base + acréscimo. */
function banco(c: Caso): SnapshotFinanceiro {
  const cheio = Number((c.base + c.extras.reduce((t, e) => t + e, 0)).toFixed(3));
  return {
    isAvulso: false,
    modalidadeFrete: c.modalidade,
    valorFrete: c.frete,
    descontoGeralTipo: "VALOR",
    descontoGeralValor: 0,
    itens: [{ id: c.item, idProduto: 3001, quantidade: c.qtd, valorUnitario: cheio, valorFixo: c.fixo, subtotal: c.subtotal, statusItem: "PENDENTE" }]
  };
}
const campos = (c: Caso, mudar: Record<string, unknown> = {}, mudarItem: Record<string, unknown> = {}) =>
  divergenciasFinanceiras(formulario(c, mudar, mudarItem), banco(c)).map((d) => d.campo);

/* 0. O valor cheio */
checar("valor cheio = base + acrescimos das variacoes", CASOS.map((c) => Number(valorUnitarioCheioDoItem({ valorUnitario: c.base, variacoesEscolhidas: escolhas(c.extras) }).toFixed(3))), [2.46, 2.6, 3.9]);
checar("sem variacao, o cheio e a base", [valorUnitarioCheioDoItem({ valorUnitario: 0.23, variacoesEscolhidas: [] }), valorUnitarioCheioDoItem({ valorUnitario: 0.23 }), valorUnitarioCheioDoItem({ valorUnitario: 0.23, variacoesEscolhidas: [{ tipo: null }, { tipo: {} }] })], [0.23, 0.23, 0.23]);
checar("numero ilegivel vira NaN (e NaN diverge)", [Number.isNaN(valorUnitarioCheioDoItem({ valorUnitario: "abc" })), Number.isNaN(valorUnitarioCheioDoItem({ valorUnitario: 1, variacoesEscolhidas: [{ tipo: { v_extra: "x" } }] }))], [true, true]);

for (const c of CASOS) {
  const quem = `${c.pedido} item ${c.item}`;
  const cheio = Number((c.base + c.extras.reduce((t, e) => t + e, 0)).toFixed(3));

  /* 1. Sem mudança */
  checar(`${quem}: sem mudanca, a trava nao aciona`, campos(c), []);

  /* 3. Arte e observação */
  checar(
    `${quem}: mudar so arte, observacao e modelos nao aciona`,
    campos(c, { observacoes: "nova observação", observacaoTecnica: "trocar a arte", modelos: [{ nome_modelo: "A", status_arte: "EM_ARTE", observacao_arte: "outra" }] }, { descricaoModelo: "arte nova", arte_url: "https://exemplo/arte.pdf" }),
    []
  );

  /* 2. Mudanças de valor continuam acionando */
  checar(`${quem}: mudar o preco base aciona`, campos(c, {}, { valorUnitario: c.base + 0.1, subtotal: c.subtotal + 0.1 * c.qtd }), ['valor unitário de "Cordão 85cm"', 'subtotal de "Cordão 85cm"']);
  checar(`${quem}: mudar a quantidade aciona`, campos(c, {}, { quantidade: c.qtd + 10, subtotal: c.subtotal + 10 * cheio }), ['quantidade de "Cordão 85cm"', 'subtotal de "Cordão 85cm"']);
  checar(`${quem}: mudar o valor fixo aciona`, campos(c, {}, { valorFixo: c.fixo + 5, subtotal: c.subtotal + 5 }), ['valor fixo de "Cordão 85cm"', 'subtotal de "Cordão 85cm"']);
  checar(`${quem}: trocar a variacao por outra de acrescimo diferente aciona`, campos(c, {}, { variacoesEscolhidas: escolhas([...c.extras.slice(0, -1), 1.5]), subtotal: c.subtotal + 0.6 * c.qtd }), ['valor unitário de "Cordão 85cm"', 'subtotal de "Cordão 85cm"']);
  checar(`${quem}: tirar a variacao aciona`, campos(c, {}, { variacoesEscolhidas: [] }).includes('valor unitário de "Cordão 85cm"'), true);
  checar(`${quem}: so o acrescimo muda (subtotal igual por engano) ainda aciona pelo unitario`, campos(c, {}, { variacoesEscolhidas: escolhas([...c.extras, 0.3]) }), ['valor unitário de "Cordão 85cm"']);

  /* 5. Meio centavo */
  checar(`${quem}: diferenca de 0,004 no unitario nao aciona`, campos(c, {}, { valorUnitario: c.base + 0.004 }), []);
  checar(`${quem}: diferenca de 0,006 no unitario aciona`, campos(c, {}, { valorUnitario: c.base + 0.006 }), ['valor unitário de "Cordão 85cm"']);

  /* A mensagem mostra os valores cheios dos dois lados */
  const d = divergenciasFinanceiras(formulario(c, {}, { valorUnitario: c.base + 1 }), banco(c)).find((x) => x.campo.startsWith("valor unitário"));
  checar(`${quem}: antes e depois sao valores cheios`, [d?.antes, Number(Number(d?.depois).toFixed(3))], [String(cheio), Number((cheio + 1).toFixed(3))]);
}

/* 4. Item sem acréscimo: igual a hoje */
const SEM: Caso = { pedido: 23353, item: 3323, qtd: 1000, base: 0.23, extras: [], fixo: 40, subtotal: 270, frete: 30, modalidade: "CIF" };
checar("item sem acrescimo: sem mudanca nao aciona", campos(SEM), []);
checar("item sem acrescimo: mudar o preco aciona", campos(SEM, {}, { valorUnitario: 0.25, subtotal: 290 }), ['valor unitário de "Cordão 85cm"', 'subtotal de "Cordão 85cm"']);
checar("item sem acrescimo: ganhar uma variacao paga aciona", campos(SEM, {}, { variacoesEscolhidas: escolhas([0.9]) }), ['valor unitário de "Cordão 85cm"']);
checar("variacao com acrescimo zero nao aciona", campos(SEM, {}, { variacoesEscolhidas: escolhas([0, 0]) }), []);

/* As outras entradas do cálculo seguem valendo */
checar("frete diferente continua acionando", campos(CASOS[1], { fretes: [{ id: "f1", valor: 60 }] }), ["valor do frete"]);
checar("desconto geral continua acionando", campos(CASOS[1], { descontoGeralValor: 10 }), ["valor do desconto geral"]);
checar("item excluido continua acionando", campos(CASOS[1], { deletedProdutoPropostaIds: [99] }), ["itens excluídos nesta edição"]);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
