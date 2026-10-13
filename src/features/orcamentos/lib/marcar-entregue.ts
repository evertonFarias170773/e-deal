/**
 * "MARCAR COMO ENTREGUE" — atalho TEMPORARIO da lista de Pedidos (11/10/2026).
 *
 * POR QUE EXISTE
 *   Pedidos que comecaram no Vibe e terminaram no sistema antigo poluem a lista
 *   de Pedidos e a Expedicao enquanto a migracao nao fecha. O ADM os marca como
 *   entregues. E um paliativo: sem "Desmarcar" nesta rodada.
 *
 * O QUE GRAVA (so por este atalho, rota `/api/orcamentos/marcar-entregue`)
 *   - `propostas.status_interno`: LIBERADO -> ENTREGUE;
 *   - `expedicoes.data_entrega`: o instante da marcacao (o dia, no fuso
 *     America/Sao_Paulo, e o da marcacao). Nunca sobrescreve uma data existente;
 *   - uma linha em `os_status_log`, com origem propria e o autor.
 *   Nao toca em faturamento, cobrancas, boletos, Conta Corrente, Conferencia nem
 *   em `encerrado_teste_em`.
 *
 * SEGUNDO ESTADO ACEITO (13/10/2026)
 *   Alem de LIBERADO, o atalho vale para o pedido que esta na Fila de Faturamento
 *   SEM producao: REVISAO ATENDENTE com `libera_nf` ligada e `is_prd_aprovado`
 *   desligada (o estado que "Enviar para Fila de Faturamento" produz — ver
 *   `lib/enviar-fila-faturamento.ts`). Esse pedido so precisava da nota; depois dela
 *   o ADM o marca como entregue, aqui ou na propria Fila. O que grava e o mesmo;
 *   so o status de partida muda. Em LIBERADO nada mudou.
 */
import { STATUS_PARA_ENVIAR_A_FILA, estaNaFilaSemProducao, type EstadoDoPedido } from "@/features/orcamentos/lib/enviar-fila-faturamento";

/** `os_status_log.origem` das linhas gravadas por este atalho. */
export const ORIGEM_LOG_ATALHO_ENTREGUE = "ATALHO_LISTA_ENTREGUE";

/** O status de partida original do atalho. */
export const STATUS_ORIGEM_ATALHO_ENTREGUE = "LIBERADO";
export const STATUS_DESTINO_ATALHO_ENTREGUE = "ENTREGUE";

/**
 * De qual status o atalho parte, dado o estado do pedido: LIBERADO, ou REVISAO
 * ATENDENTE quando o pedido esta na Fila de Faturamento sem producao. `null` = o
 * atalho nao vale para este pedido.
 */
export function statusDePartidaDoAtalhoEntregue(estado: EstadoDoPedido): string | null {
  if (String(estado.statusInterno ?? "").trim().toUpperCase() === STATUS_ORIGEM_ATALHO_ENTREGUE) return STATUS_ORIGEM_ATALHO_ENTREGUE;
  if (estaNaFilaSemProducao(estado)) return STATUS_PARA_ENVIAR_A_FILA;
  return null;
}

type UsuarioDaTela = { isSuperAdmin?: boolean | null; isAdmin?: boolean | null } | null | undefined;

/**
 * A opcao aparece no menu? So para ADM (mesmo teste de ADM da pagina) e so com
 * `status_interno` exatamente LIBERADO (o legado APROVADO nao entra) ou com o
 * pedido na Fila de Faturamento sem producao. Esconder o
 * item nao protege nada: quem tranca e a rota, que confere o ADM no servidor.
 */
export function podeVerMarcarComoEntregue(
  usuario: UsuarioDaTela,
  statusInterno: string | null | undefined,
  /** As duas flags do pedido. Sem elas, so LIBERADO passa (como antes de 13/10/2026). */
  flags?: { liberaNf: boolean | null | undefined; isPrdAprovado: boolean | null | undefined }
): boolean {
  const adm = Boolean(usuario?.isSuperAdmin || usuario?.isAdmin);
  // Sem as flags, `isPrdAprovado: true` impede o segundo estado: fica so o LIBERADO.
  return adm && statusDePartidaDoAtalhoEntregue({ statusInterno, liberaNf: flags?.liberaNf, isPrdAprovado: flags ? flags.isPrdAprovado : true }) !== null;
}

/** O teste de ADM no servidor, sobre as duas colunas de `usuarios`. */
export function ehAdmNoServidor(usuario: { is_super_adm?: boolean | null; is_admin?: boolean | null } | null | undefined): boolean {
  return Boolean(usuario?.is_super_adm || usuario?.is_admin);
}

/** O dia da marcacao no fuso de Sao Paulo, como dd/mm/aaaa. */
export function diaDaMarcacaoSaoPaulo(instante: Date): string {
  return instante.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
