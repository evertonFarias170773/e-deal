"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, Paperclip, Send } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useTarefas } from "@/features/tarefas/TarefasProvider";
import {
  baixarAnexo,
  enviarAnexo,
  enviarMensagem,
  listarAnexos,
  listarMensagens,
  marcarVista,
  mudarSituacaoTarefa,
  tamanhoLegivel,
  validarArquivo
} from "@/features/tarefas/services/tarefas.service";
import {
  ANEXO_ACCEPT,
  MENSAGEM_MAX,
  MOMENTO_ROTULO,
  OBSERVACAO_MAX,
  type Tarefa,
  type TarefaAcao,
  type TarefaAnexo,
  type TarefaMensagem
} from "@/features/tarefas/types";
import {
  podeAnexar,
  podeAssumir,
  podeCancelar,
  podeConcluir,
  dataBR,
  dataHoraBR,
  prazoVencido
} from "@/features/tarefas/lib/regras";
import { ModalBase, campoClasse, campoEstilo, rotuloClasse } from "@/features/tarefas/components/ModalBase";
import { PrioridadeBadge, SituacaoBadge } from "@/features/tarefas/components/SituacaoBadge";

type ItemHistorico =
  | { tipo: "evento"; quando: string; texto: string }
  | { tipo: "mensagem"; quando: string; mensagem: TarefaMensagem; anexos: TarefaAnexo[] };

/**
 * Detalhe da tarefa, com a conversa.
 *
 * - Abrir marca como vista (apaga o sinal piscando); se chegar novidade com o
 *   detalhe aberto, recarrega a conversa e marca de novo.
 * - Conversa: qualquer participante escreve, com anexo opcional, sem mudar a
 *   situacao. So com a tarefa aberta ou em andamento. Ninguem edita nem apaga.
 * - `modoConcluir` abre direto com observacao e anexo da conclusao.
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
  const [mensagens, setMensagens] = useState<TarefaMensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [arquivoMensagem, setArquivoMensagem] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const nome = (id: string | null) => (id ? nomes.get(id) ?? "—" : "—");
  const assumir = podeAssumir(t, userId, admin, participa);
  const concluir = podeConcluir(t, userId, admin);
  const cancelar = podeCancelar(t, userId, admin);
  const ativa = podeAnexar(t);

  const carregar = useCallback(async () => {
    try {
      const [listaAnexos, listaMensagens] = await Promise.all([listarAnexos(t.id), listarMensagens(t.id)]);
      setAnexos(listaAnexos);
      setMensagens(listaMensagens);
    } catch {
      setErro("Não foi possível carregar a conversa e os anexos.");
    }
  }, [t.id]);

  // Abrir = ver. Refaz a cada novidade que chega com o detalhe aberto
  // (`novidade_em` muda), para a conversa aparecer e o sinal nao ficar aceso.
  useEffect(() => {
    let vivo = true;
    Promise.all([listarAnexos(t.id), listarMensagens(t.id)])
      .then(([listaAnexos, listaMensagens]) => {
        if (!vivo) return;
        setAnexos(listaAnexos);
        setMensagens(listaMensagens);
      })
      .catch(() => vivo && setErro("Não foi possível carregar a conversa e os anexos."));
    void marcarVista(t.id).then(() => vivo && recarregar());
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, t.novidade_em]);

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
    await carregar();
  };

  const enviar = async () => {
    const mensagem = texto.trim();
    if (!mensagem || ocupado) return;
    setErro(null);
    setOcupado("Enviando…");
    const r = await enviarMensagem(t.id, mensagem);
    if (!r.success || typeof r.id !== "number") {
      setOcupado(null);
      setErro(r.message ?? "A mensagem não foi enviada.");
      return;
    }
    let avisoAnexo: string | null = null;
    if (arquivoMensagem) {
      setOcupado("Enviando anexo…");
      const a = await enviarAnexo(t.id, arquivoMensagem, "MENSAGEM", r.id);
      if (!a.success) avisoAnexo = a.message ?? "O anexo não subiu.";
    }
    setOcupado(null);
    setTexto("");
    setArquivoMensagem(null);
    if (avisoAnexo) setErro(`Mensagem enviada, mas o anexo não subiu: ${avisoAnexo}`);
    await carregar();
    recarregar();
  };

  const baixar = async (anexo: TarefaAnexo) => {
    const r = await baixarAnexo(anexo.id);
    if (!r.success) setErro(r.message ?? "Não foi possível baixar.");
  };

  // Historico: eventos da tarefa e mensagens, em ordem.
  const historico = useMemo<ItemHistorico[]>(() => {
    const nomeDe = (id: string | null) => (id ? nomes.get(id) ?? "—" : "—");
    const itens: ItemHistorico[] = [{ tipo: "evento", quando: t.created_at, texto: `Criada por ${nomeDe(t.criado_por_user_id)}` }];
    if (t.assumido_at) itens.push({ tipo: "evento", quando: t.assumido_at, texto: `Assumida por ${nomeDe(t.assumido_por_user_id)}` });
    if (t.concluido_at) itens.push({ tipo: "evento", quando: t.concluido_at, texto: `Concluída por ${nomeDe(t.concluido_por_user_id)}` });
    if (t.cancelado_at) itens.push({ tipo: "evento", quando: t.cancelado_at, texto: `Cancelada por ${nomeDe(t.cancelado_por_user_id)}` });
    for (const m of mensagens) {
      itens.push({ tipo: "mensagem", quando: m.created_at, mensagem: m, anexos: anexos.filter((a) => a.mensagem_id === m.id) });
    }
    return itens.sort((x, y) => new Date(x.quando).getTime() - new Date(y.quando).getTime());
  }, [t, mensagens, anexos, nomes]);

  const anexosDaTarefa = anexos.filter((a) => a.mensagem_id === null);

  const destino = t.tipo === "MELHORIA" ? "Administradores" : t.para_todos ? "Todos da equipe" : t.destinatarios.map(nome).join(", ");
  const ocupadoBool = ocupado !== null;
  const botaoSecundario = "rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50";

  const linhaAnexo = (a: TarefaAnexo, compacto = false) => (
    <li
      key={a.id}
      className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
      style={{ borderColor: "var(--border)", background: compacto ? "var(--card)" : undefined }}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{a.nome_arquivo}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {tamanhoLegivel(a.tamanho_bytes)}
          {compacto ? "" : ` · ${nome(a.enviado_por_user_id)} ${MOMENTO_ROTULO[a.momento]}`}
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
  );

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
            Assumir
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
            {ativa && !concluindo ? (
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
          {anexosDaTarefa.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Nenhum anexo.
            </p>
          ) : (
            <ul className="space-y-1.5" aria-label="Anexos da tarefa">
              {anexosDaTarefa.map((a) => linhaAnexo(a))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Histórico e conversa
          </p>
          <ul className="space-y-2" aria-label="Histórico e conversa">
            {historico.map((item) =>
              item.tipo === "evento" ? (
                <li key={`e-${item.texto}`} className="flex justify-between gap-3 text-xs" style={{ color: "var(--muted)" }}>
                  <span>{item.texto}</span>
                  <span>{dataHoraBR(item.quando)}</span>
                </li>
              ) : (
                <li
                  key={`m-${item.mensagem.id}`}
                  data-mensagem-id={item.mensagem.id}
                  className="rounded-xl border px-3 py-2"
                  style={{
                    borderColor: "var(--border)",
                    background: item.mensagem.autor_user_id === userId ? "color-mix(in srgb, var(--primary) 8%, transparent)" : "var(--background)"
                  }}
                >
                  <div className="flex justify-between gap-3 text-xs" style={{ color: "var(--muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                      {item.mensagem.autor_user_id === userId ? "Você" : nome(item.mensagem.autor_user_id)}
                    </span>
                    <span>{dataHoraBR(item.quando)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{item.mensagem.mensagem}</p>
                  {item.anexos.length > 0 ? <ul className="mt-2 space-y-1.5">{item.anexos.map((a) => linhaAnexo(a, true))}</ul> : null}
                </li>
              )
            )}
          </ul>
          {t.observacao_conclusao ? (
            <p className="mt-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                Observação da conclusão:{" "}
              </span>
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
        ) : ativa && !confirmarCancelar ? (
          <form
            aria-label="Escrever na conversa"
            className="rounded-xl border p-3"
            style={{ borderColor: "var(--border)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <label htmlFor="tarefa-mensagem" className={rotuloClasse}>
              Responder sem mudar a situação
            </label>
            <textarea
              id="tarefa-mensagem"
              rows={2}
              value={texto}
              maxLength={MENSAGEM_MAX}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escreva uma mensagem para quem participa da tarefa"
              className={campoClasse}
              style={campoEstilo}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--primary)" }}>
                <Paperclip className="h-3.5 w-3.5" />
                {arquivoMensagem ? arquivoMensagem.name : "Anexar arquivo"}
                <input
                  id="tarefa-mensagem-anexo"
                  type="file"
                  accept={ANEXO_ACCEPT}
                  className="sr-only"
                  disabled={ocupadoBool}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    const ruim = f ? validarArquivo(f) : null;
                    setErro(ruim);
                    setArquivoMensagem(ruim ? null : f);
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={ocupadoBool || texto.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-50"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                <Send className="h-4 w-4" />
                {ocupado === "Enviando…" || ocupado === "Enviando anexo…" ? ocupado : "Enviar"}
              </button>
            </div>
          </form>
        ) : !ativa ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Tarefa encerrada: a conversa ficou só para leitura.
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
