"use client";

import { useEffect, useMemo, useState } from "react";
import { Paperclip, Search, Users, X } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import {
  criarTarefa,
  enviarAnexo,
  listarPessoasEquipe,
  tamanhoLegivel,
  validarArquivo
} from "@/features/tarefas/services/tarefas.service";
import {
  ANEXO_ACCEPT,
  DESCRICAO_MAX,
  PRIORIDADES,
  PRIORIDADE_ROTULO,
  TITULO_MAX,
  type PessoaEquipe,
  type TarefaPrioridade,
  type TarefaTipo
} from "@/features/tarefas/types";
import { ModalBase, campoClasse, campoEstilo, rotuloClasse } from "@/features/tarefas/components/ModalBase";
import { cn } from "@/lib/utils";

/**
 * Nova tarefa: titulo e "para quem" (uma ou mais pessoas, ou todos) sao
 * obrigatorios. Nova melhoria: sem destinatarios (qualquer admin assume).
 * `padrao` preenche pedido, cliente e detalhes quando aberta de dentro da
 * proposta, da Conferencia (dados da cobranca nos detalhes) ou do cliente.
 */
export function NovaTarefaModal({
  tipo,
  padrao,
  onFechar,
  onCriada
}: {
  tipo: TarefaTipo;
  padrao?: { idInt?: number | null; idCliente?: number | null; descricao?: string };
  onFechar: () => void;
  onCriada: (id: number) => void;
}) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const melhoria = tipo === "MELHORIA";

  const [pessoas, setPessoas] = useState<PessoaEquipe[]>([]);
  const [titulo, setTitulo] = useState("");
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>("NORMAL");
  const [paraTodos, setParaTodos] = useState(false);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [descricao, setDescricao] = useState(padrao?.descricao ?? "");
  const [idInt, setIdInt] = useState(padrao?.idInt ? String(padrao.idInt) : "");
  const [idCliente, setIdCliente] = useState(padrao?.idCliente ? String(padrao.idCliente) : "");
  const [prazo, setPrazo] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [etapa, setEtapa] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (melhoria) return;
    let vivo = true;
    listarPessoasEquipe()
      .then((lista) => vivo && setPessoas(lista))
      .catch(() => vivo && setErro("Não foi possível carregar a lista de pessoas."));
    return () => {
      vivo = false;
    };
  }, [melhoria]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return termo ? pessoas.filter((p) => p.nome.toLocaleLowerCase("pt-BR").includes(termo)) : pessoas;
  }, [pessoas, busca]);
  const nomeDe = (id: string) => pessoas.find((p) => p.user_id === id)?.nome ?? "—";

  const alternar = (id: string) =>
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));

  const adicionarArquivos = (lista: FileList | null) => {
    if (!lista) return;
    const novos = Array.from(lista);
    const ruim = novos.map(validarArquivo).find(Boolean);
    if (ruim) setErro(ruim);
    else setErro(null);
    setArquivos((atual) => [...atual, ...novos.filter((f) => !validarArquivo(f))]);
  };

  const temDestino = melhoria || paraTodos || escolhidos.length > 0;
  const podeSalvar = titulo.trim().length > 0 && temDestino && !salvando;

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    setEtapa("Criando…");
    const r = await criarTarefa({
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      prioridade,
      destinatarios: melhoria || paraTodos ? [] : escolhidos,
      para_todos: !melhoria && paraTodos,
      id_int: idInt.trim(),
      id_cliente: idCliente.trim(),
      data_limite: prazo
    });
    if (!r.success || typeof r.id !== "number") {
      setSalvando(false);
      setEtapa("");
      setErro(r.message ?? "Não foi possível criar.");
      return;
    }

    const falhas: string[] = [];
    for (const [i, arquivo] of arquivos.entries()) {
      setEtapa(`Enviando anexo ${i + 1} de ${arquivos.length}…`);
      const a = await enviarAnexo(r.id, arquivo, "CRIACAO");
      if (!a.success) falhas.push(a.message ?? arquivo.name);
    }
    setSalvando(false);
    setEtapa("");

    if (falhas.length > 0) {
      showToast({
        type: "warning",
        title: "Tarefa criada, mas há anexo que não subiu",
        description: `${falhas.join(" ")} Abra a tarefa e anexe de novo.`
      });
    } else {
      const destino = melhoria
        ? undefined
        : paraTodos
          ? "Toda a equipe vai ver no menu Tarefas."
          : `${escolhidos.map(nomeDe).join(", ")} ${escolhidos.length > 1 ? "vão" : "vai"} ver no menu Tarefas.`;
      showToast({ type: "success", title: melhoria ? "Melhoria registrada" : "Tarefa criada", description: destino });
    }
    onCriada(r.id);
  };

  return (
    <ModalBase
      titulo={melhoria ? "Nova melhoria" : "Nova tarefa"}
      onFechar={salvando ? () => {} : onFechar}
      rodape={
        <>
          {etapa ? (
            <span className="mr-auto self-center text-xs" style={{ color: "var(--muted)" }}>
              {etapa}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!podeSalvar}
            className="rounded-xl px-4 py-2 text-sm font-bold shadow-sm disabled:opacity-50"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <div>
          <label htmlFor="tarefa-titulo" className={rotuloClasse}>
            {melhoria ? "O que melhorar" : "O que precisa ser feito"} *
          </label>
          <input
            id="tarefa-titulo"
            autoFocus
            value={titulo}
            maxLength={TITULO_MAX}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={melhoria ? "Ex.: filtro por vendedor na Conferência" : "Ex.: conseguir a OC com o cliente"}
            className={campoClasse}
            style={campoEstilo}
          />
        </div>

        <div>
          <span className={rotuloClasse}>Prioridade</span>
          <div className="inline-flex rounded-xl border p-0.5" role="radiogroup" aria-label="Prioridade" style={{ borderColor: "var(--border)" }}>
            {PRIORIDADES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={prioridade === p}
                onClick={() => setPrioridade(p)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  prioridade === p && p === "URGENTE" && "bg-red-600 text-white",
                  prioridade === p && p === "ALTA" && "bg-amber-500 text-white",
                  prioridade === p && p === "NORMAL" && "bg-slate-600 text-white"
                )}
                style={prioridade === p ? undefined : { color: "var(--muted)" }}
              >
                {PRIORIDADE_ROTULO[p]}
              </button>
            ))}
          </div>
        </div>

        {!melhoria ? (
          <div>
            <span className={rotuloClasse}>Para quem *</span>
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <input
                type="checkbox"
                id="tarefa-todos"
                checked={paraTodos}
                onChange={(e) => setParaTodos(e.target.checked)}
              />
              <Users className="h-4 w-4" />
              Todos da equipe
            </label>
            {!paraTodos ? (
              <>
                {escolhidos.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Pessoas escolhidas">
                    {escolhidos.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                      >
                        {nomeDe(id)}
                        <button type="button" aria-label={`Tirar ${nomeDe(id)}`} onClick={() => alternar(id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4" style={{ color: "var(--muted)" }} />
                  <input
                    id="tarefa-busca-pessoa"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar pessoa"
                    className={cn(campoClasse, "pl-9")}
                    style={campoEstilo}
                  />
                </div>
                <ul
                  id="tarefa-pessoas"
                  className="mt-1.5 max-h-40 overflow-y-auto rounded-xl border"
                  style={{ borderColor: "var(--border)" }}
                >
                  {filtradas.map((p) => (
                    <li key={p.user_id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:opacity-80">
                        <input
                          type="checkbox"
                          data-pessoa={p.nome}
                          checked={escolhidos.includes(p.user_id)}
                          onChange={() => alternar(p.user_id)}
                        />
                        {p.nome}
                        {p.user_id === user?.id ? " (eu)" : ""}
                      </label>
                    </li>
                  ))}
                  {filtradas.length === 0 ? (
                    <li className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
                      Ninguém com esse nome.
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            A melhoria fica visível para a diretoria e os administradores. Qualquer um deles pode assumir.
          </p>
        )}

        <div>
          <label htmlFor="tarefa-descricao" className={rotuloClasse}>
            Detalhes
          </label>
          <textarea
            id="tarefa-descricao"
            value={descricao}
            maxLength={DESCRICAO_MAX}
            onChange={(e) => setDescricao(e.target.value)}
            rows={3}
            className={campoClasse}
            style={campoEstilo}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="tarefa-pedido" className={rotuloClasse}>
              Nº do pedido
            </label>
            <input
              id="tarefa-pedido"
              inputMode="numeric"
              value={idInt}
              onChange={(e) => setIdInt(e.target.value.replace(/\D/g, ""))}
              className={campoClasse}
              style={campoEstilo}
            />
          </div>
          <div>
            <label htmlFor="tarefa-cliente" className={rotuloClasse}>
              Código do cliente
            </label>
            <input
              id="tarefa-cliente"
              inputMode="numeric"
              value={idCliente}
              onChange={(e) => setIdCliente(e.target.value.replace(/\D/g, ""))}
              className={campoClasse}
              style={campoEstilo}
            />
          </div>
          <div>
            <label htmlFor="tarefa-prazo" className={rotuloClasse}>
              Prazo
            </label>
            <input
              id="tarefa-prazo"
              type="date"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              className={campoClasse}
              style={campoEstilo}
            />
          </div>
        </div>

        <div>
          <span className={rotuloClasse}>Anexos (PDF ou imagem, até 10 MB cada)</span>
          <label
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ borderColor: "var(--border)", color: "var(--primary)" }}
          >
            <Paperclip className="h-4 w-4" />
            Escolher arquivos
            <input
              id="tarefa-anexos"
              type="file"
              multiple
              accept={ANEXO_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                adicionarArquivos(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {arquivos.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs" aria-label="Arquivos escolhidos">
              {arquivos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {f.name} <span style={{ color: "var(--muted)" }}>({tamanhoLegivel(f.size)})</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Tirar ${f.name}`}
                    onClick={() => setArquivos((atual) => atual.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {erro ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {erro}
          </p>
        ) : null}
      </form>
    </ModalBase>
  );
}
