import type { PropostaFrete } from "@/features/orcamentos/types";
import { transportadoraDoServicoGravado } from "@/features/orcamentos/lib/transportadoras-parceiras";

/**
 * Nome do frete que volta do banco (14/11/2026). `cotacao_frete` só guarda o
 * serviço; ao reler, o card ganha a transportadora pelo serviço gravado. É a
 * mesma regra para a leitura (`mapCotacaoRowToPropostaFrete`, que o box 9 mostra
 * depois do Salvar) e para o texto que o Salvar grava em `propostas.texto_whatsapp`.
 */
export function rotuloDoServicoGravado(servico: string | null | undefined): { transportadora: string; servico: string } {
  return { transportadora: transportadoraDoServicoGravado(servico), servico: servico || "" };
}

/**
 * Cards que o carregamento da proposta fabrica quando ela não tem linha em
 * `cotacao_frete` (proposta sem cotação, como a cópia recém-criada).
 */
export const CARDS_SEM_COTACAO = new Set(["frete_retirada", "frete_sedex", "frete_pac", "frete_transportadora"]);

/**
 * O frete do texto que o Salvar grava. Card fabricado de proposta sem cotação,
 * num Salvar que regrava `cotacao_frete`: vai com o nome com que ele volta do
 * banco, o mesmo que o box 9 mostra depois de salvar. Antes o texto gravado dizia
 * "Transportadora Parceira (Entrega Padrão)" e o box, "Entrega Padrão", e o envio
 * pelo ChatGuru recusava. Qualquer outro card fica como está.
 */
export function freteDoTextoGravado<T extends PropostaFrete | undefined>(
  card: T,
  opcoes: { regravaCotacao: boolean; servicoGravado: string | null | undefined }
): T {
  if (!card || !opcoes.regravaCotacao || !CARDS_SEM_COTACAO.has(String(card.id))) return card;
  return { ...card, ...rotuloDoServicoGravado(opcoes.servicoGravado) };
}
