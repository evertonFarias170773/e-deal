import type { Proposta, PropostaFrete, PropostaItem, PropostaResumo } from "@/features/orcamentos/types";

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
