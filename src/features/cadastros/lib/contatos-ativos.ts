import type { CadastroContato } from "@/features/cadastros/types";

/**
 * Contato inativo (06/11/2026): regra única de quem pode ser ESCOLHIDO.
 *
 * O cadastro acumula contatos antigos e repetidos. Inativado, o contato sai da
 * escolha (proposta nova, troca de cliente, envios automáticos), mas não some:
 * a proposta antiga que o usou continua mostrando-o. Por isso quem escolhe
 * passa aqui o contato que já está selecionado (`manterId`) — ele fica na
 * lista mesmo inativo, e o "Salvar" da proposta antiga não troca de contato.
 */
export function contatoEstaAtivo(contato: Pick<CadastroContato, "ativo"> | null | undefined): boolean {
  return contato?.ativo !== false;
}

export function contatosParaEscolher<T extends Pick<CadastroContato, "id" | "ativo">>(
  contatos: readonly T[],
  manterId?: string | null
): T[] {
  const manter = String(manterId ?? "").trim();
  return contatos.filter((c) => contatoEstaAtivo(c) || (manter !== "" && c.id === manter));
}

/** O primeiro contato ativo, para quem precisa de um contato padrão. */
export function primeiroContatoAtivo<T extends Pick<CadastroContato, "ativo">>(contatos: readonly T[]): T | undefined {
  return contatos.find((c) => contatoEstaAtivo(c));
}
