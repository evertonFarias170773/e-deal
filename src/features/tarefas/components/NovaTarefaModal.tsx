"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { criarTarefa, listarPessoasEquipe } from "@/features/tarefas/services/tarefas.service";
import { DESCRICAO_MAX, TITULO_MAX, type PessoaEquipe, type TarefaTipo } from "@/features/tarefas/types";
import { ModalBase, campoClasse, campoEstilo, rotuloClasse } from "@/features/tarefas/components/ModalBase";

/**
 * Nova tarefa: so titulo e "para quem" sao obrigatorios.
 * Nova melhoria: "responsavel" e opcional e lista so administradores (o banco
 * recusa melhoria atribuida a quem nao e admin).
 */
export function NovaTarefaModal({
  tipo,
  onFechar,
  onCriada
}: {
  tipo: TarefaTipo;
  onFechar: () => void;
  onCriada: () => void;
}) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const melhoria = tipo === "MELHORIA";

  const [pessoas, setPessoas] = useState<PessoaEquipe[]>([]);
  const [titulo, setTitulo] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [descricao, setDescricao] = useState("");
  const [idInt, setIdInt] = useState("");
  const [idCliente, setIdCliente] = useState("");
  const [prazo, setPrazo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listarPessoasEquipe()
      .then((lista) => vivo && setPessoas(melhoria ? lista.filter((p) => p.admin) : lista))
      .catch(() => vivo && setErro("Não foi possível carregar a lista de pessoas."));
    return () => {
      vivo = false;
    };
  }, [melhoria]);

  const podeSalvar = titulo.trim().length > 0 && (melhoria || responsavel !== "") && !salvando;

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    const r = await criarTarefa({
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      responsavel_user_id: responsavel || null,
      id_int: idInt.trim(),
      id_cliente: idCliente.trim(),
      data_limite: prazo
    });
    setSalvando(false);
    if (!r.success) {
      setErro(r.message ?? "Não foi possível criar.");
      return;
    }
    const para = pessoas.find((p) => p.user_id === responsavel)?.nome;
    showToast({
      type: "success",
      title: melhoria ? "Melhoria registrada" : "Tarefa criada",
      description: para ? `${para} vai ver no contador de tarefas.` : undefined
    });
    onCriada();
  };

  return (
    <ModalBase
      titulo={melhoria ? "Nova melhoria" : "Nova tarefa"}
      onFechar={onFechar}
      rodape={
        <>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
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
          <label htmlFor="tarefa-para" className={rotuloClasse}>
            {melhoria ? "Responsável (opcional)" : "Para quem *"}
          </label>
          <select
            id="tarefa-para"
            value={responsavel}
            onChange={(e) => setResponsavel(e.target.value)}
            className={campoClasse}
            style={campoEstilo}
          >
            <option value="">{melhoria ? "Ninguém ainda" : "Escolha a pessoa"}</option>
            {pessoas.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.nome}
                {p.user_id === user?.id ? " (eu)" : ""}
              </option>
            ))}
          </select>
        </div>

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

        {erro ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {erro}
          </p>
        ) : null}
      </form>
    </ModalBase>
  );
}
