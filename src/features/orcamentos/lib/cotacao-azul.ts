/**
 * Leitura da cotação automática da Azul Cargo (webhook `cotacao-azul` do n8n).
 *
 * POR QUE ESTE ARQUIVO EXISTE (27/10/2026)
 *   Até aqui a cotação pedia só o serviço ECOMM. O webhook passou a devolver,
 *   com `SiglaServico` vazio, TODOS os serviços do contrato da Ideal — hoje
 *   ECOMM, EXPRESSO e STANDARD — e cada um vira um card. Este módulo é a única
 *   regra de quais nomes entram e com que texto, porque esse texto vai para
 *   `cotacao_frete.servico` e `propostas.frete_escolhido`, e é por ele que o
 *   resto do sistema reconhece o transporte (ver `servicos-transportadora.ts`).
 *
 * OS NOMES
 *   - "ECOMM" continua "ECOMM": é o que sempre foi gravado, e a lista da aba
 *     Fretes já o trata como sinônimo de AZUL ECOMM.
 *   - STANDARD, EXPRESSO e PREMIUM gravam "AZUL STANDARD", "AZUL EXPRESSO" e
 *     "AZUL PREMIUM", os mesmos nomes da lista da aba Fretes. O nome cru
 *     ("STANDARD") cairia em INDEFINIDO em `normalizarTipoFrete` e em
 *     `exp__tipo_frete_do_texto`, e perderia o vínculo com a SVT.
 *   - Qualquer outro nome da Azul (os `_CORP`, por exemplo) é ignorado.
 *
 * RESPOSTA VAZIA
 *   Serviço fora do contrato faz a Azul devolver `Value: []`, e o webhook
 *   responde corpo vazio com HTTP 200. Isso é "nenhuma opção da Azul", não erro.
 */
import type { PropostaFrete } from "@/features/orcamentos/types";

/** Nome devolvido pela Azul (`NomeServico`) → texto gravado no Vibe. */
const NOME_GRAVADO_POR_SERVICO_AZUL: Readonly<Record<string, string>> = {
  ECOMM: "ECOMM",
  STANDARD: "AZUL STANDARD",
  EXPRESSO: "AZUL EXPRESSO",
  PREMIUM: "AZUL PREMIUM"
};

/** Margem aplicada sobre o total da Azul (regra de sempre, 27/10/2026). */
export const MARGEM_AZUL = 1.15;

/** O texto gravado para um serviço da Azul, ou `null` quando ele não entra. */
export function nomeServicoAzul(nomeApi: unknown): string | null {
  const chave = String(nomeApi ?? "").trim().toUpperCase();
  return NOME_GRAVADO_POR_SERVICO_AZUL[chave] ?? null;
}

/**
 * Corpo do webhook → itens crus. Aceita array, objeto único (formato antigo)
 * e corpo vazio (zero opções). Qualquer outra coisa é resposta inválida.
 */
export function lerCorpoCotacaoAzul(corpo: string): Record<string, unknown>[] {
  if (!corpo.trim()) return [];
  const data: unknown = JSON.parse(corpo);
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  throw new Error("Resposta inválida da cotação Azul Cargo.");
}

/** Itens crus do webhook → cards da Azul, já filtrados, nomeados e com margem. */
export function mapearCotacoesAzul(
  itens: Record<string, unknown>[],
  input: { id_int?: number | string; volumes: number; pesoKg: number; pesoGramas: number }
): PropostaFrete[] {
  const cards: PropostaFrete[] = [];
  for (const item of itens) {
    const servico = nomeServicoAzul(item.Servico);
    if (servico === null) continue;

    const prazo = item.Prazo as number | undefined;
    const total = Number(item.Total || 0);
    const valorFinal = total * MARGEM_AZUL;
    const prazoText = prazo ? (prazo === 1 ? "1 dia útil" : `${prazo} dias úteis`) : "Sob consulta";
    const idCotacao = item.ID_Cotacao !== undefined ? Number(item.ID_Cotacao) : undefined;

    cards.push({
      // "frete_azul_ecomm_0" para o ECOMM, como sempre foi.
      id: `frete_azul_${servico.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${cards.length}`,
      id_int: typeof input.id_int === "number" ? input.id_int : Number(input.id_int) || 0,
      transportadora: "Azul Cargo",
      servico,
      valor: valorFinal, // usar SEMPRE o valor final já com margem da Azul.
      prazo: prazoText,
      observacao: `Volumes: ${input.volumes} | Peso: ${input.pesoKg.toFixed(2)} KG | Valor original: ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      escolhido: false,
      pesoUsado: input.pesoGramas,
      valorOriginal: total,
      valorMargem: valorFinal,
      volumes: input.volumes,
      pesoKg: input.pesoKg,
      id_cotacao: idCotacao
    });
  }
  return cards;
}
