/**
 * Fila de Faturamento × NFS-e — quando um pedido sai da Fila por já ter a nota
 * de serviço emitida.
 *
 * Módulo puro: só importa as regras da NFS-e (lib/regras-emissao). É um recorte DA TELA,
 * sobre as linhas que `getFaturaveisPropostas` já devolveu: a consulta que
 * monta a Fila não sabe de NFS-e e não muda.
 *
 * A REGRA (07/10/2026)
 *   Pedido com NFS-e AUTORIZADA sai da Fila por padrão: o financeiro o procura
 *   no Histórico. A caixa "Mostrar também pedidos com NFS-e emitida" traz de
 *   volta — o pedido ainda pode ter NF-e a emitir. NFS-e em qualquer outro
 *   estado (rascunho, em análise, erro) NÃO esconde: ali ainda há trabalho.
 *
 * FAIL-SAFE
 *   Enquanto a leitura das notas de serviço não chegou, ou se ela falhou,
 *   NADA é escondido. Esconder um pedido por falta de informação é pior do que
 *   mostrar um que já foi atendido.
 */
import { decidirNfseDoPedido, type NotaDeServicoDoPedido } from "@/features/nfse/lib/regras-emissao";

/** O pedido tem NFS-e autorizada? (a mesma decisão do botão "NFS-e nº N") */
export function pedidoTemNfseAutorizada(notas: readonly NotaDeServicoDoPedido[] | undefined): boolean {
  return decidirNfseDoPedido(notas ?? []).acao === "MOSTRAR_AUTORIZADA";
}

export type LeituraDasNfse<N extends NotaDeServicoDoPedido> = {
  /** As notas de serviço por número do pedido. */
  porPedido: ReadonlyMap<number, readonly N[]>;
  /** A leitura chegou inteira? `false` enquanto carrega ou se falhou. */
  pronta: boolean;
};

/**
 * Este pedido fica ESCONDIDO da Fila por causa da NFS-e?
 * Só quando a leitura está pronta, a caixa de mostrar está desmarcada e o
 * pedido tem NFS-e autorizada.
 */
export function pedidoOcultoPorNfse<N extends NotaDeServicoDoPedido>(
  idInt: number | null | undefined,
  leitura: LeituraDasNfse<N>,
  mostrarComNfseEmitida: boolean
): boolean {
  if (mostrarComNfseEmitida || !leitura.pronta) return false;
  const numero = Number(idInt);
  if (!Number.isFinite(numero) || numero <= 0) return false;
  return pedidoTemNfseAutorizada(leitura.porPedido.get(numero));
}

/** "(+M com NFS-e emitida)" ao lado do contador, ou vazio quando não há ocultos. */
export function rotuloDosOcultosPorNfse(ocultos: number): string {
  return ocultos > 0 ? `(+${ocultos} com NFS-e emitida)` : "";
}
