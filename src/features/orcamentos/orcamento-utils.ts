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

export function sortEnderecosPorPrioridade(enderecos: CadastroEndereco[]): CadastroEndereco[] {
  return [...enderecos].sort((a, b) => {
    const getPriority = (addr: CadastroEndereco) => {
      const t = ((addr as any).tipo_endereco ?? addr.tipo ?? "").trim().toLowerCase();
      if (t === "principal") return 1;
      if (t === "entrega") return 2;
      return 3;
    };
    const pA = getPriority(a);
    const pB = getPriority(b);
    if (pA !== pB) return pA - pB;
    const dateA = new Date((a as any).data_criacao || 0).getTime();
    const dateB = new Date((b as any).data_criacao || 0).getTime();
    return dateB - dateA;
  });
}

export function buildPropostaInformalText({
  id_int,
  clienteNome,
  itens,
  frete,
  resumo,
  formaPagamento,
  isAvulso = false,
  contatoNome,
  cidade,
  uf,
  bonusPercent = 0
}: {
  id_int: number | string;
  clienteNome: string;
  itens: PropostaItem[];
  frete?: PropostaFrete;
  resumo: PropostaResumo;
  formaPagamento: string;
  isAvulso?: boolean;
  contatoNome?: string;
  cidade?: string;
  uf?: string;
  bonusPercent?: number;
}) {
  const contactName = contatoNome || clienteNome || "cliente";

  let itemsText = "";
  if (isAvulso) {
    itemsText = `✅ *Orçamento Avulso*: *${formatPlainCurrency(resumo.subtotalProdutos)}*`;
  } else {
    itemsText = itens
      .map((item) => {
        return `✅ *${item.quantidade.toLocaleString("pt-BR")}* ${item.nome}: *${formatPlainCurrency(item.subtotal)}* (${item.prazo})`;
      })
      .join("\n");
  }

  let freteMsg = "";
  const isRetirada = frete && (frete.transportadora === "Retirada Local" || frete.id === "frete_retira_balcao");
  const freteEscolhido = frete && frete.transportadora && frete.transportadora !== "Frete nao definido" && !isRetirada;
  if (freteEscolhido) {
    const transportadoraLower = frete.transportadora.toLowerCase();
    const servicoLower = frete.servico?.toLowerCase() ?? "";
    const isDuplicate = servicoLower && (transportadoraLower.includes(servicoLower) || servicoLower.includes(transportadoraLower));
    const servicoText = (frete.servico && !isDuplicate) ? ` (${frete.servico})` : "";
    
    freteMsg = `Frete via *${frete.transportadora}${servicoText}: ${formatPlainCurrency(frete.valor)}*`;
  } else if (isRetirada) {
    freteMsg = `Frete via *Retirada Local: Grátis*`;
  } else {
    freteMsg = "Como ainda não definimos o frete, me avisa se precisa que eu verifique o valor para o seu endereço?";
  }

  const lines = [
    `Olá, 😀`,
    ``,
    `Orçamento para:`,
    `*${contactName}*`,
    ``,
    `📄 Proposta *${id_int}*`,
    ``,
    `*Segue orçamento para os itens solicitados.*`,
    (bonusPercent > 0) ? `Consegui aplicar uma condição especial para você!` : null,
    ``,
    `*Produtos Orçados:*`,
    ``,
    itemsText || "✅ Nenhum produto adicionado",
    ``,
    (bonusPercent > 0) ? `Subtotal bruto ${formatPlainCurrency(resumo.subtotalBrutoProdutos)}` : null,
    (bonusPercent > 0) ? `` : null,
    (bonusPercent > 0) ? `Tabela especial do cliente aplicada (-${bonusPercent}%)  -${formatPlainCurrency(resumo.acrescimoBonus)}` : null,
    (bonusPercent > 0) ? `` : null,
    freteMsg,
    (cidade && uf && freteEscolhido) ? `Cidade: *${cidade} - ${uf}*` : null,
    ``,
    `O valor total do pedido ficou em *${formatPlainCurrency(resumo.valorTotal)}*`,
    ``,
    `Se estiver tudo certo, me confirma por aqui que já dou andamento ao processo!`
  ];

  return lines.filter(line => line !== null && line !== undefined).join("\n");
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

export function getClienteBonusPercent(cliente: Cadastro | null | undefined): number {
  if (!cliente) {
    return 0;
  }
  
  if (cliente.usaPrecoFixo) {
    return 0; // Bônus é ignorado se usaPrecoFixo for true
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
  const variationExtra = (item.variacoesEscolhidas || []).reduce((total, escolha) => total + (escolha.tipo?.v_extra || 0), 0);
  const valorUnitarioTotal = item.valorUnitario + variationExtra;
  
  const subtotalBruto = item.quantidade * valorUnitarioTotal + item.valorFixo;
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

export function createItemFromProduto(
  produto: Produto, 
  quantidade = 1000, 
  bonusPercent = 0, 
  autoSelectVariations = true,
  precoFixoBase?: number
): PropostaItem {
  const variacoesEscolhidas = autoSelectVariations ? firstVariationChoices(produto) : [];
  
  const precoBaseReal = precoFixoBase !== undefined ? precoFixoBase : produto.valorUnt;

  const baseItem = {
    id: `item_${produto.id_produto}_${Date.now()}`,
    id_produto: produto.id_produto,
    produto,
    nome: produto.nomeReal,
    formato: produto.formato,
    descricaoModelo: produto.descricao,
    quantidade,
    valorUnitario: precoBaseReal,
    valorFixo: precoFixoBase !== undefined ? 0 : produto.valorFixo,
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

  const mocks: PropostaFrete[] = [
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

  if (endereco?.uf?.toUpperCase() === "RS") {
    mocks.push({
      id: "frete_retira_balcao",
      id_int,
      transportadora: "Retirada Local",
      servico: "Sem custo",
      valor: 0.00,
      prazo: "Imediato",
      observacao: "Retirar pessoalmente no balcão da empresa",
      escolhido: false,
      pesoUsado
    });
  }

  return mocks;
}

export function calculateResumo(
  itens: PropostaItem[],
  fretes: PropostaFrete[],
  descontoGeralValor = 0,
  descontoGeralTipo: TipoDescontoProposta = "VALOR"
): PropostaResumo {
  const activeItens = itens.filter(item => item.statusItem !== "CANCELADO");

  const subtotalBrutoProdutos = activeItens.reduce((total, item) => total + item.subtotalBruto, 0);
  const descontosIndividuais = activeItens.reduce((total, item) => total + item.descontoValorCalculado, 0);
  const acrescimoBonus = activeItens.reduce((total, item) => total + item.acrescimoBonus, 0);
  const subtotalProdutos = activeItens.reduce((total, item) => total + item.subtotal, 0);
  const descontoGeral = Math.min(subtotalProdutos, calculateDiscountValue(subtotalProdutos, descontoGeralTipo, descontoGeralValor));
  const freteEscolhido = fretes.find((frete) => frete.escolhido);
  const frete = freteEscolhido?.valor ?? 0;
  const pesoTotal = activeItens.reduce((total, item) => total + item.pesoTotal, 0);
  const prazoProducao = activeItens[0]?.prazo ?? "Nao definido";
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
