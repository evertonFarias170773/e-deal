import type { Tarefa } from "@/features/tarefas/types";

/**
 * Espelho, na tela, da regra da trigger `tarefas_equipe__guarda`. Serve so para
 * mostrar ou esconder botao; quem decide de verdade e o banco.
 */

const ativa = (t: Tarefa) => t.status === "ABERTA" || t.status === "EM_ANDAMENTO";

/**
 * Recebi a tarefa: sou destinatario escolhido, ou ela e para todos E eu
 * participo das Tarefas (`participa` — ver lib/participacao.ts).
 */
export function recebida(t: Tarefa, userId: string, participa: boolean) {
  return t.tipo === "TAREFA" && ((t.para_todos && participa) || t.destinatarios.includes(userId));
}

export function podeAssumir(t: Tarefa, userId: string, admin: boolean, participa: boolean) {
  return t.status === "ABERTA" && (admin || recebida(t, userId, participa));
}

export function podeConcluir(t: Tarefa, userId: string, admin: boolean) {
  return t.status === "EM_ANDAMENTO" && (admin || t.responsavel_user_id === userId);
}

export function podeCancelar(t: Tarefa, userId: string, admin: boolean) {
  return ativa(t) && (admin || t.criado_por_user_id === userId);
}

export function podeAnexar(t: Tarefa) {
  return ativa(t);
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

/** "Para Ana, Bruno e mais 2" / "Para todos" / "Sem responsável". */
export function descreverDestino(t: Tarefa, nome: (id: string | null) => string) {
  if (t.responsavel_user_id) return `Com ${nome(t.responsavel_user_id)}`;
  if (t.para_todos) return "Para todos";
  if (t.destinatarios.length === 0) return "Sem responsável";
  const nomes = t.destinatarios.map((d) => nome(d));
  if (nomes.length <= 2) return `Para ${nomes.join(" e ")}`;
  return `Para ${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
}
