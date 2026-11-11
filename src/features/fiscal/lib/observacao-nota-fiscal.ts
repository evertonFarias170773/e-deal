/**
 * "Observação para a nota fiscal" do pedido (`propostas.obs_nota_fiscal`, 11/11/2026).
 *
 * Caso que originou: pedido 25049, a NF precisava levar o nome do projeto e o
 * número de captação da Rouanet. O vendedor escreve na proposta (bloco "4. Dados
 * para nota fiscal" da aba Geral, ou na aba "Produção / Expedição / Notas"; é a
 * mesma coluna) e o texto vai para as Informações Complementares:
 *
 *   NF-e   rascunho novo nasce com "Pedido N" e, na linha de baixo, a observação.
 *          Rascunho que já existia não muda sozinho: a tela da nota oferece
 *          "Incluir" quando a observação não está no texto.
 *   NFS-e  a janela "NFS-e · Pedido" abre com a observação nas Informações
 *          complementares (antes nascia vazia).
 *
 * O bloco "10. Observações e Condições" (`obs_proposta`) continua interno e
 * NÃO entra na nota: aparece só como selo na Fila e nas janelas das notas.
 *
 * LIMITES
 *   NF-e   `infCpl` do leiaute 4.00: até 5.000 caracteres. O que vai no XML é
 *          o texto da nota e, quando há endereço de entrega, " | " e o
 *          endereço (`fn_montar_payload_nfe`).
 *   NFS-e  `xInfComp` da NFS-e nacional: até 2.000 caracteres
 *          (`LIMITE_INFORMACOES_COMPLEMENTARES_NFSE`, que a janela já trava).
 *
 * Módulo puro, sem imports.
 */

export const LIMITE_INFORMACOES_COMPLEMENTARES_NFE = 5000;
/** Igual a `LIMITE_INFORMACOES_COMPLEMENTARES_NFSE` (composicao-nfse); o teste confere. */
export const LIMITE_INFORMACOES_COMPLEMENTARES_NFSE_NACIONAL = 2000;

/** Sem bordas em branco, quebra de linha única ("\n"), tabulação vira espaço. */
export function observacaoLimpa(texto: unknown): string {
  if (typeof texto !== "string") return "";
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((linha) => linha.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

/** A observação já está no texto da nota? (compara ignorando espaços e quebras). */
export function observacaoJaNoTexto(texto: string | null | undefined, observacao: string | null | undefined): boolean {
  const obs = normalizarParaComparar(observacaoLimpa(observacao));
  if (!obs) return true;
  return normalizarParaComparar(String(texto ?? "")).includes(obs);
}

/**
 * O texto da nota com a observação no fim, em linha própria. Não apaga nada do
 * que já existe e não repete a observação que já está lá.
 */
export function complementaresComObservacao(textoAtual: string | null | undefined, observacao: string | null | undefined): string {
  const atual = String(textoAtual ?? "").replace(/\s+$/g, "");
  const obs = observacaoLimpa(observacao);
  if (!obs || observacaoJaNoTexto(atual, obs)) return atual;
  return atual.trim() ? `${atual}\n${obs}` : obs;
}

/** Quantos caracteres vão no `infCpl` da NF-e: o texto e, se houver, " | " e o endereço de entrega. */
export function tamanhoNoXmlDaNfe(texto: string | null | undefined, enderecoDeEntrega?: string | null): number {
  const base = String(texto ?? "").trim();
  const endereco = String(enderecoDeEntrega ?? "").trim();
  return [base, endereco].filter(Boolean).join(" | ").length;
}

export type ConferenciaDeTamanho = {
  nfe: { tamanho: number; limite: number; passou: boolean };
  nfse: { tamanho: number; limite: number; passou: boolean };
};

/**
 * Como a observação chega em cada nota, para o aviso na proposta.
 * NF-e: "Pedido N" + quebra + observação (o rascunho novo). NFS-e: só a observação.
 */
export function conferirTamanhoDaObservacao(observacao: string | null | undefined, idInt: number | string | null | undefined): ConferenciaDeTamanho {
  const obs = observacaoLimpa(observacao);
  const pedido = Number(idInt) > 0 ? `Pedido ${Number(idInt)}` : "Pedido 00000";
  const nfe = obs ? complementaresComObservacao(pedido, obs).length : 0;
  const nfse = obs.length;
  return {
    nfe: { tamanho: nfe, limite: LIMITE_INFORMACOES_COMPLEMENTARES_NFE, passou: nfe > LIMITE_INFORMACOES_COMPLEMENTARES_NFE },
    nfse: { tamanho: nfse, limite: LIMITE_INFORMACOES_COMPLEMENTARES_NFSE_NACIONAL, passou: nfse > LIMITE_INFORMACOES_COMPLEMENTARES_NFSE_NACIONAL }
  };
}

function normalizarParaComparar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().toLowerCase();
}
