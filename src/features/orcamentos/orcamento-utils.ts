import type { Cadastro, CadastroEndereco } from "@/features/cadastros/types";
import type { Produto } from "@/features/produtos/types";
import type {
  Proposta,
  PropostaFrete,
  PropostaItem,
  PropostaResumo,
  TipoDescontoProposta,
  PropostaVariacaoEscolhida
} from "@/features/orcamentos/types";

export function getCobrancaLabel(status: Proposta["cobrancaStatus"]) {
  const labels = {
    NAO_GERADA: "Nao gerada",
    PENDENTE: "Pendente",
    GERADA: "Gerada",
    PAGA: "Paga",
    CANCELADA: "Cancelada"
  };

  return labels[status];
}

export function buildPropostaInformalText({
  id_int,
  clienteNome,
  itens,
  frete,
  resumo,
  formaPagamento,
  isAvulso = false
}: {
  id_int: number | string;
  clienteNome: string;
  itens: PropostaItem[];
  frete?: PropostaFrete;
  resumo: PropostaResumo;
  formaPagamento: string;
  isAvulso?: boolean;
}) {
  if (isAvulso) {
    return `No prop. ${id_int} | Cliente ${clienteNome}

Orcamento conforme solicitacao (Modo Avulso)

Valor produtos: ${formatPlainCurrency(resumo.subtotalProdutos)}
Frete: ${formatPlainCurrency(resumo.frete)}
Total final: ${formatPlainCurrency(resumo.valorTotal)}
Forma de pagamento: ${formaPagamento}`;
  }

  const produtos = itens
    .map((item) => {
      const variacoes = item.variacoesEscolhidas.length
        ? `\n   Variacoes: ${item.variacoesEscolhidas
            .map((escolha) => `${escolha.variacao.nome}: ${escolha.tipo.variacao}`)
            .join(", ")}`
        : "";

      const desconto = item.descontoValorCalculado > 0 ? `\n   Desconto: -${formatPlainCurrency(item.descontoValorCalculado)}` : "";
      const bonus = item.acrescimoBonus > 0 ? `\n   Tabela especial: -${formatPlainCurrency(item.acrescimoBonus)}` : "";

      return `- ${item.descricaoModelo || item.nome}\n   Quantidade: ${item.quantidade.toLocaleString("pt-BR")}\n   Prazo: ${item.prazo}\n   Subtotal: ${formatPlainCurrency(item.subtotal)}${desconto}${bonus}${variacoes}`;
    })
    .join("\n\n");

  const lines = [
    `No prop. ${id_int} | Cliente ${clienteNome}`,
    "",
    "Orcamento conforme solicitacao",
    "",
    "Produto(s)",
    produtos || "- Nenhum produto adicionado",
    "",
    "Frete escolhido",
    frete ? `${frete.transportadora} - ${frete.servico} - ${formatPlainCurrency(frete.valor)} - ${frete.prazo}` : "Frete nao definido",
    "",
    `Subtotal produtos: ${formatPlainCurrency(resumo.subtotalProdutos)}`
  ];

  if (resumo.descontosIndividuais > 0) {
    lines.push(`Descontos individuais: ${formatPlainCurrency(resumo.descontosIndividuais)}`);
  }
  if (resumo.acrescimoBonus > 0) {
    lines.push(`Tabela especial do cliente: -${formatPlainCurrency(resumo.acrescimoBonus)}`);
  }
  if (resumo.descontoGeral > 0) {
    lines.push(`Desconto geral: ${formatPlainCurrency(resumo.descontoGeral)}`);
  }

  lines.push(`Total final: ${formatPlainCurrency(resumo.valorTotal)}`);
  lines.push(`Forma de pagamento: ${formaPagamento}`);

  return lines.join("\n");
}

function formatPlainCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
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

// Simulação temporária visual para cotação de fretes caso as transportadoras não estejam disponíveis
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
      observacao: "Opcao economica.",
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
