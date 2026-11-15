/**
 * Desconto concedido pela gerência (15/11/2026, pedido do Everton).
 *
 * Quem não tem a permissão de desconto geral (admin, gerente, super admin ou
 * `propostas.desconto_geral`) salva normalmente uma proposta com desconto,
 * desde que desconto, itens, quantidades, preços e frete continuem iguais ao
 * que estava gravado quando a tela abriu. Observações, contatos, arte, entrega,
 * prazo e os demais campos ficam livres. Mudou algo que afeta o valor: a tela
 * recusa com MENSAGEM_DESCONTO_DA_GERENCIA.
 *
 * Por quê: o desconto em percentual se recalcula sobre o subtotal dos produtos
 * (mais quantidade = mais desconto em reais), e o valor fixo fica parado
 * enquanto o total muda. Qualquer mudança de valor pelo vendedor mexeria no
 * acordo da gerência.
 *
 * Trava só da tela (decisão do dono): sem gatilho nem migration.
 * Vale também para o bônus do cliente que o Maestro grava como desconto geral.
 */

export const MENSAGEM_DESCONTO_DA_GERENCIA =
  "Esta proposta tem desconto concedido pela gerência. Para alterar itens, quantidades, preços ou frete, peça ao gerente.";

type ItemDeValor = {
  id: string;
  id_produto: number;
  quantidade: number;
  valorUnitario: number;
  valorFixo: number;
  variacoesEscolhidas: { id_variacao: number }[];
};

export type FormularioDeValor = {
  isAvulso?: boolean;
  descontoGeralTipo?: string | null;
  descontoGeralValor?: string | number | null;
  itens: ItemDeValor[];
  deletedProdutoPropostaIds?: unknown[] | null;
  freteEscolhidoId?: string | null;
  modalidadeFrete?: string | null;
  valorProdutosManual?: string | null;
  valorFreteManual?: string | null;
};

export type ResumoDeValor = {
  subtotalProdutos: number;
  descontoGeral: number;
  frete: number;
  valorTotal: number;
};

/** O que afeta o valor da proposta, num formato comparável. */
export type AssinaturaDeValor = {
  desconto: string;
  itens: string;
  frete: string;
  avulsa: string;
  totais: string;
};

const centavos = (v: unknown) => Math.round((Number(v) || 0) * 100);
const numero = (v: unknown) => Number(v) || 0;

export function assinaturaDeValor(form: FormularioDeValor, resumo: ResumoDeValor): AssinaturaDeValor {
  const itens = [...form.itens]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((it) =>
      [
        it.id,
        it.id_produto,
        numero(it.quantidade),
        numero(it.valorUnitario),
        numero(it.valorFixo),
        it.variacoesEscolhidas.map((v) => v.id_variacao).sort((x, y) => x - y).join(".")
      ].join(":")
    )
    .join("|");
  return {
    desconto: `${form.descontoGeralTipo ?? ""}:${numero(form.descontoGeralValor)}`,
    itens: `${itens}#removidos=${form.deletedProdutoPropostaIds?.length ?? 0}`,
    frete: `${form.freteEscolhidoId ?? ""}:${form.modalidadeFrete ?? ""}`,
    avulsa: form.isAvulso ? `${form.valorProdutosManual ?? ""}:${form.valorFreteManual ?? ""}` : "",
    totais: [resumo.subtotalProdutos, resumo.descontoGeral, resumo.frete, resumo.valorTotal].map(centavos).join(":")
  };
}

/** Tem desconto geral (percentual ou valor maior que zero). */
export function temDescontoGeral(valor: string | number | null | undefined): boolean {
  return numero(valor) > 0;
}

/**
 * Decide o Salvar de quem não pode mexer no desconto.
 * - "livre": sem desconto, ou nada que afeta o valor mudou;
 * - "sem_permissao": proposta sem base (nova) com desconto digitado;
 * - "valor_mudou": proposta com desconto e algo de valor mudou.
 */
export function conferirDescontoDaGerencia(entrada: {
  podeEditarDesconto: boolean;
  base: AssinaturaDeValor | null;
  descontoNaBase: boolean;
  atual: AssinaturaDeValor;
  descontoAtual: boolean;
}): "livre" | "sem_permissao" | "valor_mudou" {
  if (entrada.podeEditarDesconto) return "livre";
  if (!entrada.base) return entrada.descontoAtual ? "sem_permissao" : "livre";
  if (!entrada.descontoNaBase && !entrada.descontoAtual) return "livre";
  const b = entrada.base;
  const a = entrada.atual;
  const igual = b.desconto === a.desconto && b.itens === a.itens && b.frete === a.frete && b.avulsa === a.avulsa && b.totais === a.totais;
  return igual ? "livre" : "valor_mudou";
}
