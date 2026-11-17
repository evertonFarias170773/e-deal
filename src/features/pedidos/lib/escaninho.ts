/**
 * ESCANINHO DE ENCONTRO DOS PEDIDOS COMPOSTOS (17/11/2026) — boletim de produção.
 *
 * A produção tem 28 escaninhos físicos para juntar as partes de um pedido com
 * itens em 2 ou mais setores. Quem escolhe e guarda é o banco
 * (migration 20261117c_escaninhos_encontro):
 *   - `escaninho_do_boletim(id_int)`: na primeira geração do boletim do pedido
 *     composto, o primeiro escaninho livre pela ordem; na reimpressão, o mesmo;
 *     com os 28 ocupados, SEM_LIVRE (nada é bloqueado);
 *   - libera no despacho da Expedição (`expedicoes.data_despacho`) e no
 *     cancelamento (`propostas.status_interno`).
 * Este arquivo só traduz a resposta para a tarja do PDF. Sem imports de propósito.
 */

export type SituacaoEscaninho = "OCUPADO" | "SEM_LIVRE" | "LIBERADO" | "UM_SETOR" | "NAO_LIBERADO";

export type EscaninhoDoBoletim = { situacao: SituacaoEscaninho; nome: string | null };

/** Lado esquerdo da tarja, em maiúsculas e minúsculas; o nome vai à direita, em caixa alta. */
export const ROTULO_ESCANINHO = "Escaninho de encontro das OS.";
export const SEM_ESCANINHO_LIVRE = "SEM ESCANINHO LIVRE";

/** O boletim é de pedido composto quando há modelos de outro setor além do dele. */
export function boletimEhComposto(boletim: { setor: string | null; outrosSetores: unknown[] }): boolean {
  return Boolean(boletim.setor) && boletim.outrosSetores.length > 0;
}

/** A resposta do RPC (linha única ou lista) vira o escaninho, ou `null` se veio vazia/estranha. */
export function lerRespostaDoEscaninho(data: unknown): EscaninhoDoBoletim | null {
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha || typeof linha !== "object") return null;
  const { situacao, nome } = linha as { situacao?: unknown; nome?: unknown };
  const validas: SituacaoEscaninho[] = ["OCUPADO", "SEM_LIVRE", "LIBERADO", "UM_SETOR", "NAO_LIBERADO"];
  if (typeof situacao !== "string" || !validas.includes(situacao as SituacaoEscaninho)) return null;
  return { situacao: situacao as SituacaoEscaninho, nome: typeof nome === "string" && nome.trim() ? nome.trim() : null };
}

/**
 * O que vai na tarja vermelha, depois do rótulo. `null` = sem tarja: pedido de um
 * setor só, pedido que já saiu (despachado ou cancelado) ou falha na leitura.
 */
export function textoDaTarjaDoEscaninho(escaninho: EscaninhoDoBoletim | null | undefined): string | null {
  if (!escaninho) return null;
  if (escaninho.situacao === "OCUPADO" && escaninho.nome) return escaninho.nome;
  if (escaninho.situacao === "SEM_LIVRE") return SEM_ESCANINHO_LIVRE;
  return null;
}
