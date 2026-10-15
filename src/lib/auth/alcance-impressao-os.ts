/**
 * Quem imprime o boletim (PDF da OS) — decisão do dono, 15/10/2026.
 *
 * A Produção pode e deve imprimir o boletim de QUALQUER OS liberada para
 * produção. Antes, a rota `/api/pedidos/imprimir-os` exigia, além de
 * `pedidos.print_os`, uma das `propostas.view_*` (alcance por vendedor ou
 * empresa). O perfil Produção não tem nenhuma — e não precisa: ele entra em
 * qualquer OS, vê os produtos e edita o prazo, e o servidor recusava só a
 * impressão (403 "Acesso negado a esta proposta.").
 *
 * A REGRA
 *   Imprime quem tem `pedidos.print_os` E alcance sobre a OS. O alcance vem de
 *   um destes:
 *     - `producao.view` ("Visualizar Kanban": o quadro de produção com TODOS os
 *       pedidos) — o acesso de produção do perfil Produção;
 *     - o alcance de proposta de sempre (`propostas.view_*`, conferido no
 *       servidor por `verificarEscopoPropostaServerSide`).
 *   A OS continua tendo de estar liberada para produção (409) e existir (404).
 *
 * SÓ NA IMPRESSÃO
 *   `verificarEscopoPropostaServerSide` NÃO muda: cancelar cobrança, cancelar
 *   proposta, rastrear e rotacionar QR seguem com o alcance de antes.
 *
 * Sem imports de propósito: roda na rota, na tela e no teste do Node.
 */

export const PERMISSAO_IMPRIMIR_OS = "pedidos.print_os";
/** O acesso de produção: ver o quadro de produção com todos os pedidos. */
export const PERMISSAO_ACESSO_PRODUCAO = "producao.view";

const ESCOPOS_DE_PROPOSTA = [
  "propostas.view_all",
  "propostas.view_company",
  "propostas.view_team",
  "propostas.view_own"
] as const;

function tem(permissoes: readonly string[] | null | undefined, chave: string): boolean {
  const lista = permissoes ?? [];
  return lista.includes("*") || lista.includes(chave);
}

/**
 * O acesso de produção dispensa o alcance de proposta na impressão? Só com
 * `producao.view` (ou `*`).
 */
export function alcanceDeImpressaoPelaProducao(permissoes: readonly string[] | null | undefined): boolean {
  return tem(permissoes, PERMISSAO_ACESSO_PRODUCAO);
}

/**
 * O botão de imprimir aparece? Mesma regra do servidor, na medida em que a
 * tela consegue saber: super admin e admin como sempre; os demais precisam de
 * `pedidos.print_os` e de alcance — o de produção ou algum `propostas.view_*`.
 * (O casamento fino do `view_own`/`view_company` com a proposta continua no
 * servidor; a tela só não oferece o botão a quem não tem alcance nenhum.)
 */
export function podeImprimirOsNaTela(usuario: {
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  permissoes?: readonly string[] | null;
} | null | undefined): boolean {
  if (!usuario) return false;
  if (usuario.isSuperAdmin || usuario.isAdmin) return true;
  const permissoes = usuario.permissoes ?? [];
  if (!tem(permissoes, PERMISSAO_IMPRIMIR_OS)) return false;
  return alcanceDeImpressaoPelaProducao(permissoes) || ESCOPOS_DE_PROPOSTA.some((e) => tem(permissoes, e));
}
