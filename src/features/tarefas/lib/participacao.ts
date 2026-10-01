/**
 * Quem participa das Tarefas (01/10/2026).
 *
 * Definido por PERFIL, em Configurações → Perfis e Permissões, grupo "Tarefas":
 * a permissao `tarefas.participar`. Quem participa aparece em "Para quem",
 * recebe tarefa, entra em "Todos da equipe" e cria tarefa. O Super Administrador
 * passa pelo `*`.
 *
 * Contas de teste (e-mail @teste.com.br) nunca participam, mesmo com a permissao.
 *
 * A MESMA regra esta no banco, em `tarefas_equipe__eh_da_equipe` (migration
 * tarefas_equipe_participar) — e e ela que decide. Este arquivo serve para a
 * tela mostrar a lista certa e nao oferecer o que o banco vai recusar. Mudou
 * aqui, mude la.
 */

export const PERMISSAO_PARTICIPAR_TAREFAS = "tarefas.participar";
export const DOMINIO_EMAIL_TESTE = "@teste.com.br";

export function ehEmailDeTeste(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase().endsWith(DOMINIO_EMAIL_TESTE);
}

/** O perfil (lista de permissoes de um perfil ATIVO) participa das Tarefas? */
export function perfilParticipaDasTarefas(permissoes: readonly string[] | null | undefined) {
  return Boolean(permissoes && (permissoes.includes("*") || permissoes.includes(PERMISSAO_PARTICIPAR_TAREFAS)));
}

/** A pessoa participa: perfil com a permissao e e-mail que nao e de teste. */
export function participaDasTarefas(pessoa: { email?: string | null; permissoes?: readonly string[] | null } | null | undefined) {
  if (!pessoa) return false;
  return perfilParticipaDasTarefas(pessoa.permissoes) && !ehEmailDeTeste(pessoa.email);
}
