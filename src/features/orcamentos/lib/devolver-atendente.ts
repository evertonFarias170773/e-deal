/**
 * "VOLTAR PARA REVISAO ATENDENTE" (tela Producao) pela rota do servidor (13/10/2026).
 *
 * QUEM PODE: exatamente quem ja via o botao na tela Producao
 * (`user.isSuperAdmin || user.isAdmin || hasPermissao(user, "pedidos.admin")`).
 * A regra abaixo e o ESPELHO, no servidor, de como a tela monta esses tres valores
 * (`usuarios.service.ts`), sem restringir nem ampliar:
 *   - com perfil ATIVO: vale o que o perfil diz — `*` (super admin),
 *     `admin.usuarios.view` (admin) ou `pedidos.admin`. As colunas `is_admin` e
 *     `is_super_adm` do cadastro NAO contam (quem esta em "Acesso Pendente" nao ve o
 *     botao, mesmo com a coluna marcada);
 *   - sem perfil ativo (legado): vale `is_super_adm` ou `is_admin`.
 * Por isso a rota nao usa `verificarPermissaoServerSide`, que aceita `is_super_adm`
 * antes de olhar o perfil.
 */

export const PERMISSAO_DEVOLVER_AO_ATENDENTE = "pedidos.admin";

/** `os_status_log.origem` das linhas gravadas por esta acao. */
export const ORIGEM_LOG_DEVOLVER_ATENDENTE = "DEVOLVER_ATENDENTE";

export function podeDevolverAoAtendente(entrada: {
  /** Permissoes do perfil ATIVO do usuario; `null` quando ele nao tem perfil ativo. */
  permissoesDoPerfil: readonly string[] | null;
  isAdmin: boolean | null | undefined;
  isSuperAdm: boolean | null | undefined;
}): boolean {
  const { permissoesDoPerfil } = entrada;
  if (permissoesDoPerfil === null) return entrada.isSuperAdm === true || entrada.isAdmin === true;
  return (
    permissoesDoPerfil.includes("*") ||
    permissoesDoPerfil.includes("admin.usuarios.view") ||
    permissoesDoPerfil.includes(PERMISSAO_DEVOLVER_AO_ATENDENTE)
  );
}
