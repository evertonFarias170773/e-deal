import type { PropostaFrete } from "@/features/orcamentos/types";
import { transportadoraDoServicoGravado } from "@/features/orcamentos/lib/transportadoras-parceiras";

/**
 * O card de frete como o banco o devolve (14/11/2026).
 *
 * `cotacao_frete` só guarda o serviço, o valor, o prazo, o peso e a origem; ao
 * reler, a transportadora sai do serviço gravado. Por isso um card escolhido na
 * tela ("Transportadora São Miguel", "Motoboy", "Azul Cargo"...) volta com outro
 * nome depois do Salvar, e o box 9 mostra esse nome. O texto que o Salvar grava em
 * `propostas.texto_whatsapp` é montado a partir do card relido por esta mesma
 * função, para bater com o box 9 depois de recarregar (Enviar pelo ChatGuru).
 */

export type LinhaDaCotacao = {
  id: number | string;
  id_int: number | string;
  servico?: string | null;
  valor?: number | string | null;
  prazo?: string | null;
  funcionamento_loja?: string | null;
  escolhido?: boolean | null;
  peso?: number | string | null;
  origem?: string | null;
};

/** Linha de `cotacao_frete` -> card da proposta. Única leitura (frete.service usa esta). */
export function mapCotacaoRowToPropostaFrete(row: LinhaDaCotacao): PropostaFrete {
  // Origem (21/10/2026): so os dois valores do CHECK contam; o resto e linha antiga.
  const origem = row.origem === "COTACAO" || row.origem === "MANUAL" ? row.origem : null;
  return {
    id: String(row.id),
    id_int: Number(row.id_int),
    transportadora: transportadoraDoServicoGravado(row.servico),
    servico: row.servico || "",
    valor: Number(row.valor || 0),
    prazo: row.prazo || "Sob consulta",
    observacao: row.funcionamento_loja || "",
    escolhido: Boolean(row.escolhido),
    pesoUsado: Number(row.peso || 0),
    origem,
    // Card calculado relido: o valor gravado E o do card (ele nao se edita).
    ...(origem === "COTACAO" ? { valorCotado: Number(row.valor || 0) } : {})
  };
}

/**
 * O frete do texto que o Salvar grava. Quando o Salvar regrava `cotacao_frete`,
 * o card do texto é a linha que vai ser gravada, relida por
 * `mapCotacaoRowToPropostaFrete` — o mesmo card que o box 9 mostra depois de
 * recarregar. Vale para qualquer frete. Sem regravar (pedido liberado,
 * complemento), o card da tela já é o que veio do banco e fica como está.
 */
export function freteDoTextoGravado<T extends PropostaFrete | undefined>(
  card: T,
  opcoes: { regravaCotacao: boolean; linha: Omit<LinhaDaCotacao, "id" | "id_int"> }
): T {
  if (!card || !opcoes.regravaCotacao) return card;
  return mapCotacaoRowToPropostaFrete({ ...opcoes.linha, id: card.id, id_int: card.id_int, escolhido: true }) as T;
}
