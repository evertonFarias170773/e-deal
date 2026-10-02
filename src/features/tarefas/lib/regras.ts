import { PRIORIDADE_ROTULO, type Tarefa, type TarefaAlteracao, type TarefaPrioridade } from "@/features/tarefas/types";

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

/**
 * Prazo e prioridade: quem criou, quem recebeu e o responsavel, com a tarefa
 * aberta ou em andamento. Em melhoria, quem recebe sao os administradores.
 * Administrador que nao participa da tarefa nao altera.
 */
export function podeAlterarPrazoPrioridade(t: Tarefa, userId: string, admin: boolean, participa: boolean) {
  return (
    ativa(t) &&
    (t.criado_por_user_id === userId ||
      t.responsavel_user_id === userId ||
      recebida(t, userId, participa) ||
      (t.tipo === "MELHORIA" && admin))
  );
}

/** "AAAA-MM-DD" (prazo) ou timestamp ISO → "dd/mm/aaaa". */
export function dataBR(valor: string | null) {
  if (!valor) return "";
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  const d = soData ? new Date(`${valor}T12:00:00`) : new Date(valor);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

/** "AAAA-MM-DD" → "dd/mm"; com o ano quando nao e o ano corrente. */
export function dataCurtaBR(valor: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor ?? "");
  if (!m) return "";
  const curta = `${m[3]}/${m[2]}`;
  return Number(m[1]) === new Date().getFullYear() ? curta : `${curta}/${m[1]}`;
}

/** Linha do historico: "Prazo alterado de 02/10 para 05/10 por Fulano". */
export function descreverAlteracao(a: TarefaAlteracao, nome: (id: string | null) => string) {
  const quem = a.por ? `por ${nome(a.por)}` : "pelo sistema";
  if (a.campo === "PRAZO") {
    if (a.de && a.para) return `Prazo alterado de ${dataCurtaBR(a.de)} para ${dataCurtaBR(a.para)} ${quem}`;
    if (a.para) return `Prazo definido para ${dataCurtaBR(a.para)} ${quem}`;
    return `Prazo removido (era ${dataCurtaBR(a.de)}) ${quem}`;
  }
  const rotulo = (codigo: string | null) => PRIORIDADE_ROTULO[codigo as TarefaPrioridade] ?? codigo ?? "—";
  return `Prioridade alterada de ${rotulo(a.de)} para ${rotulo(a.para)} ${quem}`;
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
