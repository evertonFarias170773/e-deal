/**
 * Janela "Gerar NFS-e", composição — src/features/nfse/lib/composicao-nfse.ts
 *
 *   node --experimental-strip-types scripts/testes/nfse-composicao.test.mts
 *
 * O QUE PROVA
 *   1. Endereços: o rótulo, a repetição (mesmo logradouro, número e CEP aparece
 *      uma vez), o cadastro com texto inválido desligado e a escolha inicial.
 *   2. Itens: a soma dos marcados, o desconto geral do pedido aplicado na mesma
 *      proporção, o frete fora, e o último item que não se desmarca.
 *   3. A descrição gerada dos itens marcados e o limite de 1000 caracteres.
 *   4. Tomador: documento com máscara e contato "não informado".
 *   5. Pagamento só para conferência: cobrança cancelada fora, parcelas e
 *      vencimentos calculados, nada além do que foi lido.
 *   6. O selo da nota e a triagem dos alertas (bloqueio, atenção, informativo).
 */
import {
  alternarItemMarcado,
  contatoOuNaoInformado,
  documentoFormatado,
  enderecoComCadastroIncompleto,
  enderecoInicial,
  fatorDoDesconto,
  opcoesDeEndereco,
  pagamentosParaConferencia,
  rotuloDoEndereco,
  seloDaNota,
  separarAlertas,
  somaDosItensMarcados,
  textoDeCadastroInvalido,
  valorSugeridoDaNota,
  type EnderecoBruto
} from "../../src/features/nfse/lib/composicao-nfse.ts";
import { LIMITE_DESCRICAO_NFSE, conferirDescricao, descricaoDosItens } from "../../src/features/nfse/lib/regras-emissao.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. Endereços
const end = (sobre: Partial<EnderecoBruto>): EnderecoBruto => ({
  id: "a", logradouro: "Rua Sete de Setembro", numero: "2096", complemento: "", bairro: "Centro", cidade: "Taquari", uf: "rs", cep: "95860000", tipo: "ENTREGA", municipioReconhecido: true, ...sobre
});
checar("endereco: rotulo Rua, nº – Bairro – Cidade/UF – CEP", rotuloDoEndereco(end({})), "Rua Sete de Setembro, 2096 – Centro – Taquari/RS – CEP 95860-000");
checar("endereco: parte vazia some do rotulo", rotuloDoEndereco(end({ bairro: "", numero: "" })), "Rua Sete de Setembro – Taquari/RS – CEP 95860-000");
checar("endereco: sem nada", rotuloDoEndereco(end({ logradouro: "", numero: "", bairro: "", cidade: "", uf: "", cep: "" })), "(endereço sem dados)");
checar(
  "cadastro invalido: [object Object], NULL, undefined e <RUA>",
  ["[object Object]", "NULL", "null", "undefined", "<RUA>", "< >", "Rua A", "", "Nulo", "Rua <b>"].map(textoDeCadastroInvalido),
  [true, true, true, true, true, true, false, false, false, false]
);
checar(
  "endereco: qualquer campo com texto invalido marca cadastro incompleto",
  [end({}), end({ logradouro: "<RUA>" }), end({ bairro: "NULL" }), end({ numero: "[object Object]" }), end({ complemento: "null" })].map(enderecoComCadastroIncompleto),
  [false, true, true, true, true]
);
{
  const lista = [
    end({ id: "1", tipo: "ENTREGA" }),
    end({ id: "2", tipo: "PRINCIPAL" }), // identico ao 1
    end({ id: "3", logradouro: "RUA SETE DE SETEMBRO ", numero: "2096", cep: "95860-000" }), // identico, outra grafia
    end({ id: "4", logradouro: "Av. Brasil", numero: "10", cep: "90000000", cidade: "Taguatinga", uf: "DF", municipioReconhecido: false }),
    end({ id: "5", logradouro: "<RUA>", numero: "1", cep: "11111111" })
  ];
  const opcoes = opcoesDeEndereco(lista);
  checar("enderecos: identicos (logradouro, numero e CEP) aparecem uma vez", opcoes.length, 3);
  checar("enderecos: entre identicos fica o PRINCIPAL", [opcoes[0].id, opcoes[0].repeticoes], ["2", 3]);
  checar("enderecos: a ordem de entrada e mantida", opcoes.map((o) => o.id), ["2", "4", "5"]);
  checar("enderecos: cadastro incompleto fica marcado", opcoes.map((o) => o.incompleto), [false, false, true]);
  checar("enderecos: municipio nao reconhecido segue escolhivel", [opcoes[1].incompleto, opcoes[1].municipioReconhecido], [false, false]);
  checar("enderecos: com varios, nenhum vem escolhido", enderecoInicial(opcoes), "");
}
checar("enderecos: com um so, vem escolhido", enderecoInicial(opcoesDeEndereco([end({ id: "x" })])), "x");
checar("enderecos: dois cadastros identicos contam como um so, e vem escolhido", enderecoInicial(opcoesDeEndereco([end({ id: "x" }), end({ id: "y" })])), "x");
checar("enderecos: um so, mas com cadastro incompleto, nao vem escolhido", enderecoInicial(opcoesDeEndereco([end({ id: "x", bairro: "NULL" })])), "");
checar("enderecos: cliente sem endereco", [opcoesDeEndereco([]), enderecoInicial([])], [[], ""]);
checar(
  "enderecos: entre identicos, o utilizavel vence o de cadastro incompleto",
  opcoesDeEndereco([end({ id: "sujo", complemento: "NULL", tipo: "PRINCIPAL" }), end({ id: "limpo" })]).map((o) => [o.id, o.incompleto]),
  [["limpo", false]]
);

// 2. Itens e valor
const itens = [
  { id: 1, nome: "Ingresso MOBI", quantidade: 580, valorUnitario: 0.23, subtotal: 173.4 }, // 580 x 0,23 + 40 de fixo
  { id: 2, nome: "Pulseira", quantidade: 100, valorUnitario: 1.5, subtotal: 150 },
  { id: 3, nome: "Arte", quantidade: 1, valorUnitario: 20, subtotal: 20 }
];
const todos = new Set([1, 2, 3]);
checar("itens: soma dos marcados usa o subtotal do item (com o valor fixo)", somaDosItensMarcados(itens, todos), 343.4);
checar("itens: soma de parte", somaDosItensMarcados(itens, new Set([1, 3])), 193.4);
checar("itens: nenhum marcado", somaDosItensMarcados(itens, new Set()), 0);
checar("desconto: pedido sem desconto tem fator 1", fatorDoDesconto(343.4, 343.4), 1);
checar("desconto: 10% de desconto geral", fatorDoDesconto(18, 20), 0.9);
checar("desconto: valor estranho nunca vira acrescimo nem zera", [fatorDoDesconto(400, 343.4), fatorDoDesconto(0, 343.4), fatorDoDesconto(null, 343.4), fatorDoDesconto(10, 0), fatorDoDesconto(-5, 20)], [1, 1, 1, 1, 1]);
checar("valor sugerido: todos marcados, sem desconto (o frete nao entra)", valorSugeridoDaNota(itens, todos, 343.4), 343.4);
checar("valor sugerido: pedido com 10% de desconto", valorSugeridoDaNota([{ id: 9, nome: "Servico", quantidade: 1, valorUnitario: 20, subtotal: 20 }], new Set([9]), 18), 18);
checar("valor sugerido: parte dos itens leva o desconto na mesma proporcao", valorSugeridoDaNota(itens, new Set([2]), 309.06), 135);
checar("valor sugerido: arredonda em centavos", valorSugeridoDaNota(itens, new Set([1]), 309.06), 156.06);
checar("itens: desmarcar um de varios", [...alternarItemMarcado(todos, 2)].sort(), [1, 3]);
checar("itens: marcar de volta", [...alternarItemMarcado(new Set([1]), 2)].sort(), [1, 2]);
checar("itens: o ultimo marcado nao se desmarca", [...alternarItemMarcado(new Set([3]), 3)], [3]);

// 3. Descrição
const marcados = new Set([1, 3]);
const descricao = descricaoDosItens(23180, itens.filter((i) => marcados.has(i.id)));
checar("descricao: so os itens marcados, no formato N x nome - R$ ... un.", descricao, ["Pedido 23180", "580 x Ingresso MOBI - R$ 0,23 un.", "1 x Arte - R$ 20,00 un."].join("\n"));
checar("descricao: gerada cabe no limite", conferirDescricao(descricao).ok, true);
checar("descricao: acima de 1000 caracteres bloqueia", [LIMITE_DESCRICAO_NFSE, conferirDescricao("x".repeat(1001)).ok], [1000, false]);

// 4. Tomador
checar("documento: CPF com mascara", documentoFormatado("12345678909"), "123.456.789-09");
checar("documento: CNPJ com mascara", documentoFormatado("12345678000190"), "12.345.678/0001-90");
checar("documento: ja com mascara continua igual", documentoFormatado("12.345.678/0001-90"), "12.345.678/0001-90");
checar("documento: tamanho errado volta como esta", [documentoFormatado("12345"), documentoFormatado(null)], ["12345", ""]);
checar(
  "contato: vazio, NULL e undefined viram nao informado",
  ["", "  ", null, "NULL", "null", "undefined", "-", "fin@exemplo.com"].map(contatoOuNaoInformado),
  ["não informado", "não informado", "não informado", "não informado", "não informado", "não informado", "não informado", "fin@exemplo.com"]
);

// 5. Pagamento (só leitura)
const cob = (sobre: Record<string, unknown>) => ({ tipo: "E-FATURADO", forma: "Prazo 28/42/56 dias", valor: 300, vencimento: "2026-10-28", status: "A_VENCER", confirmado: true, parcelas: 3, intervaloDias: 14, valorEntrada: 0, ...sobre });
{
  const [p] = pagamentosParaConferencia([cob({})]);
  checar("pagamento: forma, parcelas, valor e situacao", [p.forma, p.parcelas, p.valor, p.situacao], ["Faturado · Prazo 28/42/56 dias", 3, 300, "A vencer"]);
  checar("pagamento: vencimentos pelo intervalo da condicao", p.vencimentos.map((v) => [v.numero, v.vencimento, v.valor]), [[1, "2026-10-28", 100], [2, "2026-11-11", 100], [3, "2026-11-25", 100]]);
}
{
  const [p] = pagamentosParaConferencia([cob({ valor: 100, parcelas: 3 })]);
  checar("pagamento: a ultima parcela leva o que sobra do arredondamento", [p.vencimentos.map((v) => v.valor), p.vencimentos.reduce((t, v) => t + Math.round(v.valor * 100), 0)], [[33.33, 33.33, 33.34], 10000]);
}
checar("pagamento: PIX a vista", pagamentosParaConferencia([cob({ tipo: "PIX", forma: null, valor: 198.4, vencimento: "2026-10-09", status: "PAID", parcelas: null, intervaloDias: null })]).map((p) => [p.forma, p.parcelas, p.situacao, p.vencimentos.length]), [["PIX", 1, "Pago", 1]]);
checar("pagamento: cobranca cancelada nao entra", pagamentosParaConferencia([cob({ status: "CANCELADO" }), cob({ status: "cancelada" }), cob({ tipo: "PIX", forma: null, parcelas: 1 })]).length, 1);
checar("pagamento: nao confirmado aparece dito", pagamentosParaConferencia([cob({ confirmado: false })])[0].situacao, "A vencer (não confirmado)");
checar("pagamento: sem intervalo, so a 1a parcela tem data", pagamentosParaConferencia([cob({ intervaloDias: 0 })])[0].vencimentos.map((v) => v.vencimento), ["2026-10-28", null, null]);
checar("pagamento: pedido sem cobranca", pagamentosParaConferencia([]), []);
checar("pagamento: tipo desconhecido aparece como veio", pagamentosParaConferencia([cob({ tipo: "OUTRO", forma: null, parcelas: 1 })])[0].forma, "OUTRO");
checar(
  "pagamento: so campos de conferencia (nada para enviar)",
  Object.keys(pagamentosParaConferencia([cob({})])[0]).sort(),
  ["forma", "parcelas", "situacao", "valor", "vencimentos"]
);

// 6. Selo e alertas
checar(
  "selo: Rascunho, Em analise, Autorizada, Erro",
  (["RASCUNHO", "EM_ANALISE", "AUTORIZADA", "REENVIAR", "ENCERRADA", null] as const).map((s) => seloDaNota(s).rotulo),
  ["Rascunho", "Em análise", "Autorizada", "Erro", "Erro", "Rascunho"]
);
const a = (codigo: string, bloqueia_envio = false) => ({ tipo: bloqueia_envio ? "ERRO" : "ALERTA", codigo, mensagem: codigo, bloqueia_envio });
{
  const s = separarAlertas([a("INSCRICAO_MUNICIPAL_NFSE_NAO_INFORMADA"), a("NATUREZA_OPERACAO_NAO_INFORMADA"), a("CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO"), a("EMAIL_TOMADOR_NAO_INFORMADO")]);
  checar("alertas: sem bloqueio vale o banner verde", s.validado, true);
  checar("alertas: informativos recolhidos", s.informativos.map((x) => x.codigo), ["INSCRICAO_MUNICIPAL_NFSE_NAO_INFORMADA", "NATUREZA_OPERACAO_NAO_INFORMADA"]);
  checar("alertas: os que pedem atencao ficam em destaque", s.atencao.map((x) => x.codigo), ["CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO", "EMAIL_TOMADOR_NAO_INFORMADO"]);
}
{
  const s = separarAlertas([a("DOCUMENTO_TOMADOR_NAO_INFORMADO", true), a("NATUREZA_OPERACAO_NAO_INFORMADA")]);
  checar("alertas: com bloqueio nao ha banner verde", [s.validado, s.bloqueios.map((x) => x.codigo), s.informativos.length], [false, ["DOCUMENTO_TOMADOR_NAO_INFORMADO"], 1]);
}
checar("alertas: nenhum alerta e validado", separarAlertas([]), { bloqueios: [], atencao: [], informativos: [], validado: true });

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
