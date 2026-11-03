import type { CadastroContato } from "@/features/cadastros/types";

/**
 * Lista de contatos e contato selecionado ao abrir a edição de uma proposta.
 *
 * Contato adicionado ou editado na própria proposta não entra na tabela
 * `contatos`: só o nome vai para `propostas.contato`. Ao reabrir, o serviço
 * procura esse nome no cadastro e, sem achar, cai no primeiro contato do
 * cliente. A tela mostrava esse outro contato como selecionado e o próximo
 * "Salvar alterações" regravava o nome dele por cima do gravado, sem aviso
 * (pedido 24648, 03/11/2026: MARIA OLIMPIA gravada, tela mostrando outro).
 *
 * Aqui o contato gravado volta para a lista e fica selecionado. A resolução do
 * serviço não muda: cobranças e visualização seguem lendo o mesmo de antes.
 */
export function contatosDaEdicao(
  contatosDoCadastro: readonly CadastroContato[],
  contatoResolvidoId: string,
  gravado: { id: string | null; nome: string } | null | undefined,
  idInt: number
): { contatos: CadastroContato[]; contatoId: string } {
  const contatos = [...contatosDoCadastro];
  const nome = (gravado?.nome ?? "").trim();

  // Mesma comparação do serviço (igualdade exata): se ele achou pelo nome, a
  // seleção dele já é a gravada.
  if (!gravado || !nome || contatos.some((c) => c.nome === gravado.nome)) {
    return { contatos, contatoId: contatoResolvidoId };
  }

  // Reaproveita o id gravado (ex.: `cont_prop_<timestamp>`) quando ele não é de
  // um contato do cadastro. Sendo — contato do cadastro renomeado só na
  // proposta —, usa outro id para não colidir com a linha original.
  const idGravado = (gravado.id ?? "").trim();
  const id = idGravado && !contatos.some((c) => c.id === idGravado) ? idGravado : `cont_gravado_${idInt}`;

  contatos.push({ id, nome, cargo: "", whatsapp: "", email: "" });
  return { contatos, contatoId: id };
}
