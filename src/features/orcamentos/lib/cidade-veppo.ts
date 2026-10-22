/**
 * Cotação VEPPO só para cidade atendida (21/10/2026).
 *
 * A VEPPO não atende todas as cidades. A lista fica em `public.cidades_veppo`
 * (`cidade`, `is_ativa`), com o nome em maiúsculas e sem acento. Cidade fora
 * da lista não tem cotação VEPPO e o webhook `coordenadas` do n8n nem é chamado.
 *
 * A COMPARAÇÃO USA SÓ AS LETRAS (decisão do Everton, 21/10/2026)
 *   Maiúsculas, sem acento e sem espaço, hífen ou apóstrofo, nos dois lados.
 *   O endereço grava "SANT'ANA DO LIVRAMENTO" e a lista "SANTANA DO LIVRAMENTO";
 *   com só maiúsculas e sem acento, uma cidade atendida perderia a VEPPO. Do
 *   mesmo jeito "Nao Me Toque" bate com "NAO-ME-TOQUE". Espaço sobrando no fim
 *   do nome (14 cidades em endereços reais) também deixa de importar.
 *
 * A REGRA DE ANTES CONTINUA, ANTES DA LISTA
 *   Só consulta VEPPO com UF = RS e cidade diferente de Porto Alegre, com a
 *   mesma expressão de sempre: fora disso a resposta é a de hoje (nenhuma
 *   cotação), sem ler a tabela. A tabela não tem UF; como só cidades do RS
 *   chegam a ela, cidade igual em outro estado não vira falso positivo.
 *
 * O texto da cidade enviado ao n8n não é normalizado: continua o de hoje.
 */

/** Chave de comparação com `cidades_veppo`: só as letras, maiúsculas e sem acento. */
export function chaveCidadeVeppo(cidade: string | null | undefined): string {
  return String(cidade ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z]/g, "");
}

/**
 * A regra de sempre (até 21/10/2026 dentro de `solicitarCotacaoVeppo`): só RS e
 * fora de Porto Alegre. Mesma expressão, para o comportamento ficar idêntico.
 */
export function regraAtualPermiteVeppo(uf: string | null | undefined, cidade: string | null | undefined): boolean {
  const ufNormalizada = uf?.trim().toUpperCase();
  const cidadeNormalizada = String(cidade || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return ufNormalizada === "RS" && cidadeNormalizada !== "PORTO ALEGRE";
}

/** Status da cotação VEPPO devolvido pela rota e pela função de servidor. */
export type StatusCotacaoVeppo =
  | "COTADA"            // n8n respondeu um valor
  | "SEM_COTACAO"       // n8n chamado, sem valor (erro, tempo, resposta vazia) — como hoje
  | "FORA_DA_REGRA"     // UF diferente de RS ou Porto Alegre — como hoje, sem chamar nada
  | "NAO_ATENDIDA"      // cidade fora de cidades_veppo — sem chamar o n8n
  | "LISTA_INDISPONIVEL"; // não deu para ler a lista — sem chamar o n8n

export const MENSAGEM_CIDADE_NAO_ATENDIDA = "Cidade não atendida pela VEPPO.";
