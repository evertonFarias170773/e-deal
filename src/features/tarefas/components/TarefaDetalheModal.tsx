"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, Paperclip } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useTarefas } from "@/features/tarefas/TarefasProvider";
import {
  baixarAnexo,
  enviarAnexo,
  listarAnexos,
  marcarVista,
  mudarSituacaoTarefa,
  tamanhoLegivel,
  validarArquivo
} from "@/features/tarefas/services/tarefas.service";
import {
  ANEXO_ACCEPT,
  MOMENTO_ROTULO,
  OBSERVACAO_MAX,
  type Tarefa,
  type TarefaAcao,
  type TarefaAnexo
} from "@/features/tarefas/types";
import {
  podeAnexar,
  podeAssumir,
  podeCancelar,
  podeConcluir,
  recebida,
  dataBR,
  dataHoraBR,
  prazoVencido
} from "@/features/tarefas/lib/regras";
import { ModalBase, campoClasse, campoEstilo, rotuloClasse } from "@/features/tarefas/components/ModalBase";
import { PrioridadeBadge, SituacaoBadge } from "@/features/tarefas/components/SituacaoBadge";

/**
 * Detalhe da tarefa. Abrir marca como vista (apaga o sinal piscando).
 * `modoConcluir` abre direto com observacao e anexo da conclusao.
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
  const { recarregar, participa } = useTarefas();
  const [concluindo, setConcluindo] = useState(modoConcluir);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [arquivoConclusao, setArquivoConclusao] = useState<File | null>(null);
  const [anexos, setAnexos] = useState<TarefaAnexo[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const nome = (id: string | null) => (id ? nomes.get(id) ?? "—" : "—");
  const assumir = podeAssumir(t, userId, admin, participa);
  const concluir = podeConcluir(t, userId, admin);
  const cancelar = podeCancelar(t, userId, admin);
  const anexar = podeAnexar(t);

  const carregarAnexos = useCallback(async () => {
    try {
      setAnexos(await listarAnexos(t.id));
    } catch {
      setErro("Não foi possível carregar os anexos.");
    }
  }, [t.id]);

  useEffect(() => {
    let vivo = true;
    listarAnexos(t.id)
      .then((lista) => vivo && setAnexos(lista))
      .catch(() => vivo && setErro("Não foi possível carregar os anexos."));
    return () => {
      vivo = false;
    };
  }, [t.id]);

  // Abrir = ver. So conta para quem recebeu (e o sinal so existe para essa pessoa).
  useEffect(() => {
    if (!recebida(t, userId, participa) || t.criado_por_user_id === userId) return;
    void marcarVista(t.id).then(() => recarregar());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  const executar = async (acao: TarefaAcao) => {
    setErro(null);
    if (acao === "concluir" && arquivoConclusao) {
      setOcupado("Enviando anexo…");
      const a = await enviarAnexo(t.id, arquivoConclusao, "CONCLUSAO");
      if (!a.success) {
        setOcupado(null);
        setErro(a.message ?? "O anexo não subiu. A tarefa não foi concluída.");
        return;
      }
    }
    setOcupado({ assumir: "Assumindo…", concluir: "Concluindo…", cancelar: "Cancelando…" }[acao]);
    const r = await mudarSituacaoTarefa(t.id, acao, acao === "concluir" ? observacao : undefined);
    setOcupado(null);
    if (!r.success) {
      setErro(r.message ?? "Não foi possível concluir a operação.");
      return;
    }
    const titulo = { assumir: "Tarefa assumida", concluir: "Tarefa concluída", cancelar: "Tarefa cancelada" }[acao];
    showToast({ type: "success", title: titulo, description: `"${t.titulo}"` });
    onMudou();
  };

  const anexarDurante = async (arquivo: File) => {
    setErro(null);
    setOcupado("Enviando anexo…");
    const a = await enviarAnexo(t.id, arquivo, "ANDAMENTO");
    setOcupado(null);
    if (!a.success) {
      setErro(a.message ?? "O anexo não subiu.");
      return;
    }
    showToast({ type: "success", title: "Anexo enviado", description: arquivo.name });
    await carregarAnexos();
  };

  const baixar = async (anexo: TarefaAnexo) => {
    const r = await baixarAnexo(anexo.id);
    if (!r.success) setErro(r.message ?? "Não foi possível baixar.");
  };

  const historico: Array<[string, string]> = [[`Criada por ${nome(t.criado_por_user_id)}`, dataHoraBR(t.created_at)]];
  if (t.assumido_at) historico.push([`Assumida por ${nome(t.assumido_por_user_id)}`, dataHoraBR(t.assumido_at)]);
  if (t.concluido_at) historico.push([`Concluída por ${nome(t.concluido_por_user_id)}`, dataHoraBR(t.concluido_at)]);
  if (t.cancelado_at) historico.push([`Cancelada por ${nome(t.cancelado_por_user_id)}`, dataHoraBR(t.cancelado_at)]);

  const destino = t.tipo === "MELHORIA" ? "Administradores" : t.para_todos ? "Todos da equipe" : t.destinatarios.map(nome).join(", ");
  const ocupadoBool = ocupado !== null;
  const botaoSecundario = "rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50";

  let rodape: ReactNode;
  if (concluindo) {
    rodape = (
      <>
        <button type="button" className={botaoSecundario} style={{ borderColor: "var(--border)" }} onClick={() => setConcluindo(false)} disabled={ocupadoBool}>
          Voltar
        </button>
        <button
          type="button"
          onClick={() => void executar("concluir")}
          disabled={ocupadoBool}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {ocupado ?? "Confirmar conclusão"}
        </button>
      </>
    );
  } else if (confirmarCancelar) {
    rodape = (
      <>
        <button type="button" className={botaoSecundario} style={{ borderColor: "var(--border)" }} onClick={() => setConfirmarCancelar(false)} disabled={ocupadoBool}>
          Voltar
        </button>
        <button
          type="button"
          onClick={() => void executar("cancelar")}
          disabled={ocupadoBool}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
        >
          {ocupado ?? "Sim, cancelar a tarefa"}
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
            style={{ borderColor: "var(--border)", color: "#dc2626" }}
            onClick={() => setConfirmarCancelar(true)}
          >
            Cancelar tarefa
          </button>
        ) : null}
        {assumir ? (
          <button
            type="button"
            onClick={() => void executar("assumir")}
            disabled={ocupadoBool}
            className="rounded-xl px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-60"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {ocupado ?? "Assumir"}
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
          <div className="flex items-center gap-1.5">
            <PrioridadeBadge prioridade={t.prioridade} />
            <SituacaoBadge status={t.status} />
          </div>
        </div>

        {t.descricao ? <p className="whitespace-pre-wrap">{t.descricao}</p> : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt style={{ color: "var(--muted)" }}>Para</dt>
          <dd>{destino || "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Responsável</dt>
          <dd>{t.responsavel_user_id ? nome(t.responsavel_user_id) : "Ninguém assumiu ainda"}</dd>
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
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Anexos
            </p>
            {anexar && !concluindo ? (
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold" style={{ color: "var(--primary)" }}>
                <Paperclip className="h-3.5 w-3.5" />
                Adicionar anexo
                <input
                  id="tarefa-anexo-durante"
                  type="file"
                  accept={ANEXO_ACCEPT}
                  className="sr-only"
                  disabled={ocupadoBool}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void anexarDurante(f);
                  }}
                />
              </label>
            ) : null}
          </div>
          {anexos.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Nenhum anexo.
            </p>
          ) : (
            <ul className="space-y-1.5" aria-label="Anexos da tarefa">
              {anexos.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.nome_arquivo}</p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {tamanhoLegivel(a.tamanho_bytes)} · {nome(a.enviado_por_user_id)} {MOMENTO_ROTULO[a.momento]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void baixar(a)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                    style={{ borderColor: "var(--border)", color: "var(--primary)" }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Baixar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
          <div className="space-y-3">
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
                placeholder="Ex.: OC recebida e anexada"
                className={campoClasse}
                style={campoEstilo}
              />
            </div>
            <div>
              <span className={rotuloClasse}>Anexo da conclusão (opcional)</span>
              <label
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--border)", color: "var(--primary)" }}
              >
                <Paperclip className="h-4 w-4" />
                {arquivoConclusao ? arquivoConclusao.name : "Escolher arquivo"}
                <input
                  id="tarefa-anexo-conclusao"
                  type="file"
                  accept={ANEXO_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    const ruim = f ? validarArquivo(f) : null;
                    setErro(ruim);
                    setArquivoConclusao(ruim ? null : f);
                  }}
                />
              </label>
            </div>
          </div>
        ) : null}

        {ocupado && !concluindo && !confirmarCancelar ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {ocupado}
          </p>
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
