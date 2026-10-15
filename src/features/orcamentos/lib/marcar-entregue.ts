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
 *
 * APROVADO (15/10/2026)
 *   APROVADO e o legado de leitura de LIBERADO (a tela ja o mostra como "Liberado") e
 *   passa a ser ponto de partida. So ele tem travas a mais, todas conferidas no
 *   servidor: flag de producao ligada, OS ou setores de OS, NF-e ou NFS-e autorizada de
 *   producao. LIBERADO e REVISAO ATENDENTE seguem como antes, sem elas.
 *
 * QUEM E ADM (15/10/2026)
 *   Tela e servidor usam o MESMO teste: `usuarios.is_admin` ou `is_super_adm`. A tela
 *   le isso de `user.isAdmNoCadastro`, nao do perfil.
 */
import { STATUS_PARA_ENVIAR_A_FILA, estaNaFilaSemProducao, type EstadoDoPedido } from "@/features/orcamentos/lib/enviar-fila-faturamento";

/** `os_status_log.origem` das linhas gravadas por este atalho. */
export const ORIGEM_LOG_ATALHO_ENTREGUE = "ATALHO_LISTA_ENTREGUE";

/** O status de partida original do atalho. */
export const STATUS_ORIGEM_ATALHO_ENTREGUE = "LIBERADO";
export const STATUS_DESTINO_ATALHO_ENTREGUE = "ENTREGUE";
/** O legado de leitura de LIBERADO: aceito como partida, com as travas de `travaDoAprovado`. */
export const STATUS_LEGADO_APROVADO = "APROVADO";

export const CODIGO_ENTREGUE_JA_NA_PRODUCAO = "JA_NA_PRODUCAO";
export const CODIGO_ENTREGUE_TEM_OS = "TEM_OS";
export const CODIGO_ENTREGUE_NOTA_EMITIDA = "NOTA_EMITIDA";

/**
 * De qual status o atalho parte, dado o estado do pedido: LIBERADO, ou REVISAO
 * ATENDENTE quando o pedido esta na Fila de Faturamento sem producao. `null` = o
 * atalho nao vale para este pedido.
 */
export function statusDePartidaDoAtalhoEntregue(estado: EstadoDoPedido): string | null {
  const status = String(estado.statusInterno ?? "").trim().toUpperCase();
  if (status === STATUS_ORIGEM_ATALHO_ENTREGUE) return STATUS_ORIGEM_ATALHO_ENTREGUE;
  if (status === STATUS_LEGADO_APROVADO) return STATUS_LEGADO_APROVADO;
  if (estaNaFilaSemProducao(estado)) return STATUS_PARA_ENVIAR_A_FILA;
  return null;
}

/**
 * As travas do APROVADO. `null` = passa. So valem quando o status de partida e
 * APROVADO; quem chama nao aplica em LIBERADO nem em REVISAO ATENDENTE. OS e notas so
 * o servidor le; ausentes, nao travam (a tela).
 */
export function travaDoAprovado(entrada: {
  isPrdAprovado: boolean | null | undefined;
  temOs?: boolean;
  /** Rotulos das notas autorizadas de producao ("NF-e 7540"); vazio = nenhuma. */
  notasEmitidas?: readonly string[];
}): { code: string; message: string } | null {
  if (entrada.isPrdAprovado === true) {
    return { code: CODIGO_ENTREGUE_JA_NA_PRODUCAO, message: "O pedido está liberado para a produção: a entrega dele é marcada pela Expedição, não por aqui." };
  }
  if (entrada.temOs === true) {
    return { code: CODIGO_ENTREGUE_TEM_OS, message: "O pedido já tem OS na produção: a entrega dele é marcada pela Expedição, não por aqui." };
  }
  if (entrada.notasEmitidas && entrada.notasEmitidas.length > 0) {
    return { code: CODIGO_ENTREGUE_NOTA_EMITIDA, message: `O pedido tem nota fiscal emitida (${entrada.notasEmitidas.join(", ")}): a entrega dele não é marcada por aqui.` };
  }
  return null;
}

/** O usuario da tela: o ADM vem do CADASTRO (`isAdmNoCadastro`), nao do perfil. */
type UsuarioDaTela = { isAdmNoCadastro?: boolean | null } | null | undefined;

/**
 * A opcao aparece no menu? So para ADM do cadastro (o mesmo teste do servidor) e so
 * com `status_interno` LIBERADO, APROVADO sem a flag de producao, ou com o pedido na
 * Fila de Faturamento sem producao. OS e nota do APROVADO so o servidor confere. Esconder o
 * item nao protege nada: quem tranca e a rota, que confere o ADM no servidor.
 */
export function podeVerMarcarComoEntregue(
  usuario: UsuarioDaTela,
  statusInterno: string | null | undefined,
  /** As duas flags do pedido. Sem elas, so LIBERADO passa (como antes de 13/10/2026). */
  flags?: { liberaNf: boolean | null | undefined; isPrdAprovado: boolean | null | undefined }
): boolean {
  const adm = usuario?.isAdmNoCadastro === true;
  // Sem as flags, `isPrdAprovado: true` impede o estado da Fila e o APROVADO: fica so o LIBERADO.
  const isPrdAprovado = flags ? flags.isPrdAprovado : true;
  const partida = statusDePartidaDoAtalhoEntregue({ statusInterno, liberaNf: flags?.liberaNf, isPrdAprovado });
  if (!adm || partida === null) return false;
  return partida !== STATUS_LEGADO_APROVADO || travaDoAprovado({ isPrdAprovado }) === null;
}

/** O teste de ADM no servidor, sobre as duas colunas de `usuarios`. */
export function ehAdmNoServidor(usuario: { is_super_adm?: boolean | null; is_admin?: boolean | null } | null | undefined): boolean {
  return Boolean(usuario?.is_super_adm || usuario?.is_admin);
}

/** O dia da marcacao no fuso de Sao Paulo, como dd/mm/aaaa. */
export function diaDaMarcacaoSaoPaulo(instante: Date): string {
  return instante.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
