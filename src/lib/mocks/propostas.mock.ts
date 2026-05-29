import type { Cadastro, CadastroEndereco } from "@/features/cadastros/types";
import type {
  Proposta,
  PropostaFrete,
  PropostaItem,
  PropostaResumo,
  PropostaStatus,
  TipoDescontoProposta,
  PropostaVariacaoEscolhida
} from "@/features/orcamentos/types";
import type { Produto } from "@/features/produtos/types";
import { cadastrosMock } from "@/lib/mocks/cadastros.mock";
import { produtosMock } from "@/lib/mocks/produtos.mock";

export const vendedoresPropostaMock = ["Edison Jr", "Caroline Silva", "Everton Farias", "Emily Boeira"];
export const statusPropostaOptions: PropostaStatus[] = ["NOVO", "AGUARDANDO", "APROVADO", "CANCELADO"];
export const formasPagamentoPropostaMock = ["Pix a vista 3 dias", "Boleto 14 dias", "Faturado 28 dias", "Cartao parcelado"];

function pickCliente(idCliente: number) {
  const cliente = cadastrosMock.find((cadastro) => cadastro.idCliente === idCliente);

  if (!cliente) {
    throw new Error(`Cliente mockado nao encontrado: ${idCliente}`);
  }

  return cliente;
}

function pickProduto(id_produto: number) {
  const produto = produtosMock.find((item) => item.id_produto === id_produto);

  if (!produto) {
    throw new Error(`Produto mockado nao encontrado: ${id_produto}`);
  }

  return produto;
}

function firstVariationChoices(produto: Produto): PropostaVariacaoEscolhida[] {
  return produto.variacoes
    .filter((variacao) => variacao.tipos.length > 0)
    .slice(0, 2)
    .map((variacao) => ({
      id: `escolha_${produto.id_produto}_${variacao.id_variacao}`,
      id_variacao: variacao.id_variacao,
      variacao: variacao.variacao,
      tipo: variacao.tipos[0]
    }));
}

export function getClienteVendedorPadrao(cliente: Cadastro) {
  return cliente.vendedor_padrao ?? cliente.vendedor;
}

export function getClienteBonusPercent(cliente?: Cadastro | null) {
  if (!cliente) {
    return 0;
  }

  return cliente.is_bonus || cliente.bonusAtivo ? cliente.percentualBonus ?? 0 : 0;
}

export function calculateDiscountValue(base: number, tipo: TipoDescontoProposta, valor: number) {
  if (tipo === "PERCENTUAL") {
    return Math.max(0, base * (valor / 100));
  }

  return Math.max(0, valor);
}

export function calculateItemSubtotal(
  item: Pick<PropostaItem, "quantidade" | "valorUnitario" | "valorFixo" | "variacoesEscolhidas" | "descontoTipo" | "descontoValor">,
  bonusPercent = 0
) {
  const variationExtra = item.variacoesEscolhidas.reduce((total, escolha) => total + escolha.tipo.v_extra * item.quantidade, 0);
  const subtotalBruto = item.quantidade * item.valorUnitario + item.valorFixo + variationExtra;
  const descontoValorCalculado = Math.min(subtotalBruto, calculateDiscountValue(subtotalBruto, item.descontoTipo, item.descontoValor));
  const acrescimoBonus = (subtotalBruto - descontoValorCalculado) * (bonusPercent / 100);

  return {
    subtotalBruto,
    descontoValorCalculado,
    acrescimoBonus,
    subtotal: Math.max(0, subtotalBruto - descontoValorCalculado - acrescimoBonus)
  };
}

export function calculateItemWeight(item: Pick<PropostaItem, "quantidade" | "pesoUnitario" | "variacoesEscolhidas">) {
  const variationWeight = item.variacoesEscolhidas.reduce((total, escolha) => total + escolha.tipo.peso * item.quantidade, 0);
  return item.quantidade * item.pesoUnitario + variationWeight;
}

export function createItemFromProduto(produto: Produto, quantidade = 1000, bonusPercent = 0, autoSelectVariations = true): PropostaItem {
  const variacoesEscolhidas = autoSelectVariations ? firstVariationChoices(produto) : [];
  const baseItem = {
    id: `item_${produto.id_produto}_${Date.now()}`,
    id_produto: produto.id_produto,
    produto,
    nome: produto.nomeReal,
    formato: produto.formato,
    descricaoModelo: produto.descricao,
    quantidade,
    valorUnitario: produto.valorUnt,
    valorFixo: produto.valorFixo,
    descontoTipo: "VALOR" as TipoDescontoProposta,
    descontoValor: 0,
    prazo: produto.prazo,
    pesoUnitario: produto.peso,
    variacoesEscolhidas
  };
  const totals = calculateItemSubtotal(baseItem, bonusPercent);

  return {
    ...baseItem,
    ...totals,
    pesoTotal: calculateItemWeight(baseItem)
  };
}

export function createFretesMock(endereco?: CadastroEndereco, id_int = 0, pesoUsado = 0): PropostaFrete[] {
  const destino = endereco ? `${endereco.cidade}/${endereco.uf}` : "destino nao definido";

  return [
    {
      id: "frete_sedex",
      id_int,
      transportadora: "Correios",
      servico: "Sedex",
      valor: 68.9,
      prazo: "2 dias uteis",
      observacao: `Entrega expressa para ${destino}.`,
      escolhido: true,
      pesoUsado
    },
    {
      id: "frete_azul",
      id_int,
      transportadora: "Azul Cargo",
      servico: "Aereo economico",
      valor: 94.5,
      prazo: "1 a 2 dias uteis",
      observacao: "Boa opcao para materiais urgentes.",
      escolhido: false,
      pesoUsado
    },
    {
      id: "frete_sao_miguel",
      id_int,
      transportadora: "Expresso Sao Miguel",
      servico: "Rodoviario",
      valor: 52.7,
      prazo: "3 dias uteis",
      observacao: "Custo competitivo para regiao Sul.",
      escolhido: false,
      pesoUsado
    },
    {
      id: "frete_unesul",
      id_int,
      transportadora: "Unesul",
      servico: "Encomenda",
      valor: 47.2,
      prazo: "4 dias uteis",
      observacao: "Opcao economica mockada.",
      escolhido: false,
      pesoUsado
    }
  ];
}

export function calculateResumo(
  itens: PropostaItem[],
  fretes: PropostaFrete[],
  descontoGeralValor = 0,
  descontoGeralTipo: TipoDescontoProposta = "VALOR"
): PropostaResumo {
  const subtotalBrutoProdutos = itens.reduce((total, item) => total + item.subtotalBruto, 0);
  const descontosIndividuais = itens.reduce((total, item) => total + item.descontoValorCalculado, 0);
  const acrescimoBonus = itens.reduce((total, item) => total + item.acrescimoBonus, 0);
  const subtotalProdutos = itens.reduce((total, item) => total + item.subtotal, 0);
  const descontoGeral = Math.min(subtotalProdutos, calculateDiscountValue(subtotalProdutos, descontoGeralTipo, descontoGeralValor));
  const freteEscolhido = fretes.find((frete) => frete.escolhido);
  const frete = freteEscolhido?.valor ?? 0;
  const pesoTotal = itens.reduce((total, item) => total + item.pesoTotal, 0);
  const prazoProducao = itens[0]?.prazo ?? "Nao definido";
  const prazoEntrega = freteEscolhido?.prazo ?? "Nao definido";

  return {
    subtotalProdutos,
    subtotalBrutoProdutos,
    descontosIndividuais,
    acrescimoBonus,
    descontoGeralTipo,
    descontoGeralValor,
    descontoGeral,
    frete,
    valorTotal: Math.max(0, subtotalProdutos - descontoGeral + frete),
    pesoTotal,
    prazoProducao,
    prazoEntrega
  };
}

function createProposta({
  id_int,
  cliente,
  empresa,
  vendedor,
  data,
  status,
  itens,
  descontoGeralTipo,
  descontoGeralValor,
  formaPagamento,
  cobrancaStatus,
  observacoes
}: {
  id_int: number;
  cliente: Cadastro;
  empresa: string;
  vendedor: string;
  data: string;
  status: PropostaStatus;
  itens: PropostaItem[];
  descontoGeralTipo: TipoDescontoProposta;
  descontoGeralValor: number;
  formaPagamento: string;
  cobrancaStatus: Proposta["cobrancaStatus"];
  observacoes: string;
}): Proposta {
  const enderecoEntrega = cliente.enderecos[0];
  const peso = itens.reduce((total, item) => total + item.pesoTotal, 0);
  const fretes = createFretesMock(enderecoEntrega, id_int, peso);
  const resumo = calculateResumo(itens, fretes, descontoGeralValor, descontoGeralTipo);

  return {
    id: `prop_${id_int}`,
    id_int,
    cliente,
    compradorAutorizado: cliente.vinculosComerciais[0],
    contato: cliente.contatos[0],
    enderecoEntrega,
    empresa,
    vendedor: vendedor || getClienteVendedorPadrao(cliente),
    data,
    status,
    itens,
    fretes,
    freteEscolhidoId: fretes.find((frete) => frete.escolhido)?.id ?? fretes[0].id,
    resumo,
    descontoGeralTipo,
    descontoGeralValor,
    formaPagamento,
    cobrancaStatus,
    observacoes
  };
}

const produtoTriband = pickProduto(101);
const produtoMobi = pickProduto(401);
const produtoCredencial = pickProduto(901);
const produtoCartao = pickProduto(801);

export const propostasMock: Proposta[] = [
  createProposta({
    id_int: 16790,
    cliente: pickCliente(120017),
    empresa: "Ideal Grafica",
    vendedor: getClienteVendedorPadrao(pickCliente(120017)),
    data: "2026-05-21",
    status: "NOVO",
    itens: [
      createItemFromProduto(produtoTriband, 2000, getClienteBonusPercent(pickCliente(120017))),
      createItemFromProduto(produtoMobi, 1000, getClienteBonusPercent(pickCliente(120017)))
    ],
    descontoGeralTipo: "VALOR",
    descontoGeralValor: 120,
    formaPagamento: "Pix a vista 3 dias",
    cobrancaStatus: "NAO_GERADA",
    observacoes: "Proposta mockada para evento corporativo com pulseiras e ingressos."
  }),
  createProposta({
    id_int: 16804,
    cliente: pickCliente(922723),
    empresa: "Ideal Biro",
    vendedor: getClienteVendedorPadrao(pickCliente(922723)),
    data: "2026-05-20",
    status: "AGUARDANDO",
    itens: [createItemFromProduto(produtoCredencial, 500, getClienteBonusPercent(pickCliente(922723)))],
    descontoGeralTipo: "VALOR",
    descontoGeralValor: 0,
    formaPagamento: "Boleto 14 dias",
    cobrancaStatus: "PENDENTE",
    observacoes: "Aguardando validacao de faturamento para credenciais."
  }),
  createProposta({
    id_int: 16821,
    cliente: pickCliente(770055),
    empresa: "E3 Brindes",
    vendedor: getClienteVendedorPadrao(pickCliente(770055)),
    data: "2026-05-18",
    status: "APROVADO",
    itens: [createItemFromProduto(produtoCartao, 1200, getClienteBonusPercent(pickCliente(770055)))],
    descontoGeralTipo: "VALOR",
    descontoGeralValor: 250,
    formaPagamento: "Faturado 28 dias",
    cobrancaStatus: "GERADA",
    observacoes: "Orgao publico com empenho mockado e aprovacao comercial."
  })
];

export function getPropostaById(id_int: number) {
  return propostasMock.find((proposta) => proposta.id_int === id_int);
}
