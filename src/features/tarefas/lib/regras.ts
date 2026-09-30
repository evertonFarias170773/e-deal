import type { Tarefa } from "@/features/tarefas/types";

/**
 * Espelho, na tela, da regra da trigger `tarefas_equipe__guarda`. Serve so para
 * mostrar ou esconder botao; quem decide de verdade e o banco.
 */

const ativa = (t: Tarefa) => t.status === "ABERTA" || t.status === "EM_ANDAMENTO";

export function podeAssumir(t: Tarefa, userId: string, admin: boolean) {
  return t.status === "ABERTA" && (admin || t.responsavel_user_id === userId);
}

export function podeConcluir(t: Tarefa, userId: string, admin: boolean) {
  return ativa(t) && (admin || t.responsavel_user_id === userId);
}

export function podeCancelar(t: Tarefa, userId: string, admin: boolean) {
  return ativa(t) && (admin || t.criado_por_user_id === userId);
}

/** "AAAA-MM-DD" (prazo) ou timestamp ISO → "dd/mm/aaaa". */
export function dataBR(valor: string | null) {
  if (!valor) return "";
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  const d = soData ? new Date(`${valor}T12:00:00`) : new Date(valor);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

export function dataHoraBR(valor: string | null) {
  if (!valor) return "";
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Hoje no fuso local, "AAAA-MM-DD". */
function hojeISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function prazoVencido(t: Tarefa) {
  return Boolean(t.data_limite) && ativa(t) && (t.data_limite as string) < hojeISO();
}
