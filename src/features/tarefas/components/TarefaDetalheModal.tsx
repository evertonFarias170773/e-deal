"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useAppToast } from "@/components/common/AppToast";
import { mudarSituacaoTarefa } from "@/features/tarefas/services/tarefas.service";
import { OBSERVACAO_MAX, type Tarefa, type TarefaAcao } from "@/features/tarefas/types";
import { podeAssumir, podeCancelar, podeConcluir, dataBR, dataHoraBR, prazoVencido } from "@/features/tarefas/lib/regras";
import { ModalBase, campoClasse, campoEstilo, rotuloClasse } from "@/features/tarefas/components/ModalBase";
import { SituacaoBadge } from "@/features/tarefas/components/SituacaoBadge";

/**
 * Detalhe da tarefa: descricao, vinculos, historico e as acoes permitidas.
 * `modoConcluir` abre direto com o campo de observacao (botao Concluir da lista).
 */
export function TarefaDetalheModal({
  tarefa: t,
  nomes,
  userId,
  admin,
  modoConcluir,
  onFechar,
  onMudou
}: {
  tarefa: Tarefa;
  nomes: Map<string, string>;
  userId: string;
  admin: boolean;
  modoConcluir: boolean;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const { showToast } = useAppToast();
  const [concluindo, setConcluindo] = useState(modoConcluir);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nome = (id: string | null) => (id ? nomes.get(id) ?? "—" : "—");
  const assumir = podeAssumir(t, userId, admin);
  const concluir = podeConcluir(t, userId, admin);
  const cancelar = podeCancelar(t, userId, admin);

  const executar = async (acao: TarefaAcao) => {
    setOcupado(true);
    setErro(null);
    const r = await mudarSituacaoTarefa(t.id, acao, acao === "concluir" ? observacao : undefined);
    setOcupado(false);
    if (!r.success) {
      setErro(r.message ?? "Não foi possível concluir a operação.");
      return;
    }
    const titulo = { assumir: "Tarefa assumida", concluir: "Tarefa concluída", cancelar: "Tarefa cancelada" }[acao];
    showToast({ type: "success", title: titulo, description: `"${t.titulo}"` });
    onMudou();
  };

  const historico: Array<[string, string]> = [[`Criada por ${nome(t.criado_por_user_id)}`, dataHoraBR(t.created_at)]];
  if (t.assumido_at) historico.push([`Assumida por ${nome(t.assumido_por_user_id)}`, dataHoraBR(t.assumido_at)]);
  if (t.concluido_at) historico.push([`Concluída por ${nome(t.concluido_por_user_id)}`, dataHoraBR(t.concluido_at)]);
  if (t.cancelado_at) historico.push([`Cancelada por ${nome(t.cancelado_por_user_id)}`, dataHoraBR(t.cancelado_at)]);

  const botaoSecundario = "rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50";

  let rodape: ReactNode;
  if (concluindo) {
    rodape = (
      <>
        <button type="button" className={botaoSecundario} style={{ borderColor: "var(--border)" }} onClick={() => setConcluindo(false)} disabled={ocupado}>
          Voltar
        </button>
        <button
          type="button"
          onClick={() => void executar("concluir")}
          disabled={ocupado}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {ocupado ? "Concluindo…" : "Confirmar conclusão"}
        </button>
      </>
    );
  } else if (confirmarCancelar) {
    rodape = (
      <>
        <button type="button" className={botaoSecundario} style={{ borderColor: "var(--border)" }} onClick={() => setConfirmarCancelar(false)} disabled={ocupado}>
          Voltar
        </button>
        <button
          type="button"
          onClick={() => void executar("cancelar")}
          disabled={ocupado}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
        >
          {ocupado ? "Cancelando…" : "Sim, cancelar a tarefa"}
        </button>
      </>
    );
  } else if (assumir || concluir || cancelar) {
    rodape = (
      <>
        {cancelar ? (
          <button
            type="button"
            className={botaoSecundario}
            style={{ borderColor: "var(--border)", color: "var(--danger, #dc2626)" }}
            onClick={() => setConfirmarCancelar(true)}
          >
            Cancelar tarefa
          </button>
        ) : null}
        {assumir ? (
          <button
            type="button"
            onClick={() => void executar("assumir")}
            disabled={ocupado}
            className="rounded-xl px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-60"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {ocupado ? "Assumindo…" : "Assumir"}
          </button>
        ) : null}
        {concluir ? (
          <button
            type="button"
            onClick={() => setConcluindo(true)}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            Concluir
          </button>
        ) : null}
      </>
    );
  }

  return (
    <ModalBase titulo={t.tipo === "MELHORIA" ? "Melhoria" : "Tarefa"} onFechar={onFechar} rodape={rodape}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-base font-semibold">{t.titulo}</h3>
          <SituacaoBadge status={t.status} />
        </div>

        {t.descricao ? <p className="whitespace-pre-wrap" style={{ color: "var(--foreground)" }}>{t.descricao}</p> : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <dt style={{ color: "var(--muted)" }}>Para</dt>
          <dd>{t.responsavel_user_id ? nome(t.responsavel_user_id) : "Sem responsável"}</dd>
          <dt style={{ color: "var(--muted)" }}>Pedida por</dt>
          <dd>{nome(t.criado_por_user_id)}</dd>
          {t.data_limite ? (
            <>
              <dt style={{ color: "var(--muted)" }}>Prazo</dt>
              <dd className={prazoVencido(t) ? "font-semibold text-red-600 dark:text-red-400" : undefined}>
                {dataBR(t.data_limite)}
                {prazoVencido(t) ? " (vencido)" : ""}
              </dd>
            </>
          ) : null}
          {t.id_int ? (
            <>
              <dt style={{ color: "var(--muted)" }}>Pedido</dt>
              <dd>
                <Link href={`/orcamentos/${t.id_int}`} className="font-semibold underline" style={{ color: "var(--primary)" }}>
                  {t.id_int}
                </Link>
              </dd>
            </>
          ) : null}
          {t.id_cliente ? (
            <>
              <dt style={{ color: "var(--muted)" }}>Cliente</dt>
              <dd>
                <Link href={`/cadastros/${t.id_cliente}`} className="font-semibold underline" style={{ color: "var(--primary)" }}>
                  {t.id_cliente}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Histórico
          </p>
          <ul className="space-y-1">
            {historico.map(([texto, quando]) => (
              <li key={texto} className="flex justify-between gap-3">
                <span>{texto}</span>
                <span style={{ color: "var(--muted)" }}>{quando}</span>
              </li>
            ))}
          </ul>
          {t.observacao_conclusao ? (
            <p className="mt-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              {t.observacao_conclusao}
            </p>
          ) : null}
        </div>

        {concluindo ? (
          <div>
            <label htmlFor="tarefa-observacao" className={rotuloClasse}>
              Observação (opcional)
            </label>
            <textarea
              id="tarefa-observacao"
              autoFocus
              rows={2}
              value={observacao}
              maxLength={OBSERVACAO_MAX}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: OC recebida e anexada ao pedido"
              className={campoClasse}
              style={campoEstilo}
            />
          </div>
        ) : null}

        {erro ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {erro}
          </p>
        ) : null}
      </div>
    </ModalBase>
  );
}
