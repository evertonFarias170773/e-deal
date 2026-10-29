/**
 * Ida e volta entre o modal "A nota não pode ser aberta ainda" (Notas fiscais)
 * e a edição do cadastro que precisa ser corrigido.
 *
 * Ida:   /cadastros/<id>/editar?foco=<campo>&reconferir=<id_int>
 * Volta: /notas-fiscais?reconferir=<id_int>
 *
 * Só monta e lê endereços de tela. Não decide quem pode editar: a edição abre
 * com as mesmas travas de sempre (cadastros.edit, cadastros.edit_fiscal) e a
 * gravação segue sob as regras do banco.
 */

export const CAMPOS_DE_CORRECAO = ["documento", "tipo_contribuinte", "inscricao_estadual", "enderecos"] as const;
export type CampoDeCorrecao = (typeof CAMPOS_DE_CORRECAO)[number];

export const ROTULO_DO_CAMPO_DE_CORRECAO: Record<CampoDeCorrecao, string> = {
  documento: "CPF/CNPJ",
  tipo_contribuinte: "Tipo de contribuinte",
  inscricao_estadual: "Inscrição estadual",
  enderecos: "Endereços"
};

function pedidoValido(valor: unknown): number | null {
  const texto = String(valor ?? "").trim();
  if (!/^[0-9]{1,9}$/.test(texto)) return null;
  const numero = Number(texto);
  return numero > 0 ? numero : null;
}

/** Edição do cadastro, já no campo pendente, lembrando qual pedido reconferir. */
export function rotaDeCorrecaoDoCadastro(
  idCliente: number,
  campo: CampoDeCorrecao,
  pedidoParaReconferir: number
): string {
  const params = new URLSearchParams({ foco: campo, reconferir: String(pedidoParaReconferir) });
  return `/cadastros/${idCliente}/editar?${params.toString()}`;
}

/** Volta para a Notas fiscais, que reconfere o pedido ao abrir. */
export function rotaDeVoltaParaReconferir(pedido: number): string {
  return `/notas-fiscais?reconferir=${pedido}`;
}

/** Lê `foco` e `reconferir` da URL da edição. Valor fora da lista é ignorado. */
export function lerCorrecaoDaUrl(params: { get(nome: string): string | null }): {
  foco: CampoDeCorrecao | null;
  pedido: number | null;
} {
  const foco = params.get("foco");
  return {
    foco: (CAMPOS_DE_CORRECAO as readonly string[]).includes(foco ?? "") ? (foco as CampoDeCorrecao) : null,
    pedido: pedidoValido(params.get("reconferir"))
  };
}

/** Lê o pedido a reconferir da URL da Notas fiscais. */
export function lerPedidoParaReconferir(params: { get(nome: string): string | null }): number | null {
  return pedidoValido(params.get("reconferir"));
}
