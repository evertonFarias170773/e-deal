"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import {
  listPropostasPendencias,
  createPropostaPendencia,
  updatePropostaPendenciaStatus,
  type PropostaPendencia
} from "@/features/orcamentos/services/propostas-pendencias.service";
import { listAllUsuarios, type ChatUsuario } from "@/features/orcamentos/services/orcamentos.service";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Plus,
  ArrowLeft,
  XCircle
} from "lucide-react";

interface PropostaPendenciasPanelProps {
  idInt: number;
  idCliente: number | null;
  className?: string;
  onPendenciasCountUpdated?: (count: number) => void;
}

const CATEGORIES = [
  { value: "CREDITO", label: "Crédito e Cadastro" },
  { value: "DOCUMENTO", label: "Falta de Documentos" },
  { value: "PAGAMENTO", label: "Pagamento e Checkout" },
  { value: "COMERCIAL", label: "Ajuste Comercial / Frete" },
  { value: "PRODUCAO", label: "Arquivos / Produção" },
  { value: "FISCAL", label: "Divergência Fiscal" },
  { value: "OUTRO", label: "Outro Motivo" }
];

const PRIORITIES = [
  { value: "BAIXA", label: "Baixa", color: "bg-slate-50 text-slate-600 border-slate-200" },
  { value: "MEDIA", label: "Média", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "ALTA", label: "Alta", color: "bg-orange-50 text-orange-700 border-orange-200" },
  { value: "URGENTE", label: "Urgente", color: "bg-red-50 text-red-700 border-red-200" }
];

const SECTORS = [
  { value: "COMERCIAL", label: "Comercial" },
  { value: "CREDITO", label: "Crédito / Análise" },
  { value: "FINANCEIRO", label: "Financeiro / Faturamento" },
  { value: "PRODUCAO", label: "Produção / Layout" },
  { value: "FISCAL", label: "Fiscal" },
  { value: "EXPEDICAO", label: "Expedição / Logística" }
];

export function PropostaPendenciasPanel({
  idInt,
  idCliente,
  className = "",
  onPendenciasCountUpdated
}: PropostaPendenciasPanelProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [pendencias, setPendencias] = useState<PropostaPendencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [users, setUsers] = useState<ChatUsuario[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Form states
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("COMERCIAL");
  const [prioridade, setPrioridade] = useState("MEDIA");
  const [responsavelSetor, setResponsavelSetor] = useState("CREDITO");
  const [responsavelUserId, setResponsavelUserId] = useState("");
  const [dataLimite, setDataLimite] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reloadData = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  // Safe stable refs for callbacks to prevent render loops
  const onCountUpdatedRef = useRef(onPendenciasCountUpdated);
  useEffect(() => {
    onCountUpdatedRef.current = onPendenciasCountUpdated;
  }, [onPendenciasCountUpdated]);

  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Load users list once on mount
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const u = await listAllUsuarios();
        if (!active) return;
        setUsers(u);
      } catch (err) {
        console.error("[PropostaPendenciasPanel] Error fetching users:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load pendencies when idInt changes or reload is requested
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setHasError(false);
      setErrorMessage("");

      const res = await listPropostasPendencias(idInt);
      if (!active) return;

      if (res.success) {
        setPendencias(res.data);
        const activeCount = res.data.filter((p) => p.status === "ABERTA" || p.status === "EM_ANDAMENTO").length;
        onCountUpdatedRef.current?.(activeCount);
      } else {
        setHasError(true);
        setErrorMessage(res.errorMessage || "Não foi possível carregar as pendências.");
        showToastRef.current?.({
          title: "Erro ao carregar",
          description: res.errorMessage || "Não foi possível carregar as pendências.",
          type: "error"
        });
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [idInt, refreshTrigger]);


  // Handle create
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      showToast({ title: "Ação bloqueada", description: "Você precisa estar autenticado.", type: "error" });
      return;
    }
    if (!titulo.trim() || !descricao.trim()) {
      showToast({ title: "Campos obrigatórios", description: "Preencha o título e a descrição.", type: "warning" });
      return;
    }

    setSubmitting(true);
    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      sector: user.sector || null
    };

    const newPendenciaPayload = {
      id_int: idInt,
      id_cliente: idCliente,
      chat_id: null,
      pagamento_id: null,
      id_empresa: user.companyId || null,
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      categoria: categoria as PropostaPendencia["categoria"],
      status: "ABERTA" as const,
      prioridade: prioridade as PropostaPendencia["prioridade"],
      responsavel_setor: responsavelSetor,
      responsavel_user_id: responsavelUserId || null,
      criado_por_user_id: user.id,
      criado_por_nome: user.name,
      data_limite: dataLimite || null,
      origem: "MANUAL"
    };

    const res = await createPropostaPendencia(newPendenciaPayload, userPayload);

    if (res.success) {
      showToast({
        title: "Sucesso",
        description: "Pendência criada e registrada na timeline do chat.",
        type: "success"
      });
      // Clear form
      setTitulo("");
      setDescricao("");
      setCategoria("COMERCIAL");
      setPrioridade("MEDIA");
      setResponsavelSetor("CREDITO");
      setResponsavelUserId("");
      setDataLimite("");
      setShowForm(false);
      reloadData();
    } else {
      showToast({
        title: "Erro RLS / Permissão",
        description: res.errorMessage || "Não foi possível criar a pendência. Verifique suas permissões.",
        type: "error"
      });
    }
    setSubmitting(false);
  };

  // Handle status update
  const handleUpdateStatus = async (
    id: number,
    status: "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA",
    pTitulo: string
  ) => {
    if (!user) return;
    setLoading(true);
    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      sector: user.sector || null
    };

    const res = await updatePropostaPendenciaStatus(id, idInt, idCliente, status, pTitulo, userPayload);
    if (res.success) {
      showToast({
        title: "Status Atualizado",
        description: `Pendência marcada como ${status} e registrada na timeline.`,
        type: "success"
      });
      reloadData();
    } else {
      showToast({
        title: "Falha de RLS / Permissão",
        description: res.errorMessage || "Você não tem autorização para atualizar esta pendência.",
        type: "error"
      });
      setLoading(false);
    }
  };

  const getPriorityBadge = (prio: string) => {
    const config = PRIORITIES.find((p) => p.value === prio) || PRIORITIES[1];
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ABERTA":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
            <Clock className="h-3 w-3" /> Aberta
          </span>
        );
      case "EM_ANDAMENTO":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
            <Loader2 className="h-3 w-3 animate-spin" /> Em Resolução
          </span>
        );
      case "CONCLUIDA":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700 border border-green-200">
            <CheckCircle2 className="h-3 w-3 text-green-600" /> Concluída
          </span>
        );
      case "CANCELADA":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 border border-slate-200">
            <XCircle className="h-3 w-3" /> Cancelada
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white min-h-[400px] ${className}`}>
      {/* Sub-Header Actions */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-3 shrink-0">
        <h3 className="text-sm font-bold text-slate-800">
          {showForm ? "Nova Pendência Manual" : `Pendências Vinculadas (${pendencias.length})`}
        </h3>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b2f4a] hover:bg-[#163f5c] text-white px-3  py-1.5 text-xs font-bold transition shadow-sm"
        >
          {showForm ? (
            <>
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-[300px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-2 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <span className="text-xs font-medium">Carregando pendências...</span>
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-slate-500 px-6 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Falha ao carregar pendências</p>
              <p className="text-xs text-slate-500 mt-1">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={reloadData}
              className="mt-2 rounded-xl bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 px-4 py-2 text-xs font-bold transition"
            >
              Tentar novamente
            </button>
          </div>
        ) : showForm ? (
          /* Form Component */
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            <div>
              <label htmlFor="p_titulo" className="block text-xs font-bold text-slate-700 mb-1.5">
                Título da Pendência *
              </label>
              <input
                id="p_titulo"
                type="text"
                required
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Nota fiscal emitida com erro ou Pix não conciliado"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0b2f4a] focus:ring-1 focus:ring-[#0b2f4a] outline-none transition"
              />
            </div>

            <div>
              <label htmlFor="p_desc" className="block text-xs font-bold text-slate-700 mb-1.5">
                Descrição do Problema *
              </label>
              <textarea
                id="p_desc"
                required
                rows={3}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Detalhes completos sobre o que precisa ser verificado e resolvido."
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0b2f4a] focus:ring-1 focus:ring-[#0b2f4a] outline-none transition resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="p_cat" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Categoria
                </label>
                <select
                  id="p_cat"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 focus:border-[#0b2f4a] outline-none transition bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="p_prio" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Prioridade
                </label>
                <select
                  id="p_prio"
                  value={prioridade}
                  onChange={(e) => setPrioridade(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 focus:border-[#0b2f4a] outline-none transition bg-white"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="p_setor" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Setor Responsável
                </label>
                <select
                  id="p_setor"
                  value={responsavelSetor}
                  onChange={(e) => setResponsavelSetor(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 focus:border-[#0b2f4a] outline-none transition bg-white"
                >
                  {SECTORS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="p_user" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Responsável Específico (Opcional)
                </label>
                <select
                  id="p_user"
                  value={responsavelUserId}
                  onChange={(e) => setResponsavelUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 focus:border-[#0b2f4a] outline-none transition bg-white"
                >
                  <option value="">Sem responsável designado</option>
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.nome_usuario} ({u.setor || "Sem setor"})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="p_prazo" className="block text-xs font-bold text-slate-700 mb-1.5">
                Data Limite (Opcional)
              </label>
              <input
                id="p_prazo"
                type="date"
                value={dataLimite}
                onChange={(e) => setDataLimite(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 focus:border-[#0b2f4a] outline-none transition bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0b2f4a] hover:bg-[#163f5c] text-white px-4 py-2.5 font-bold transition shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Salvando pendência...
                </>
              ) : (
                "Criar Pendência"
              )}
            </button>
          </form>
        ) : pendencias.length === 0 ? (
          /* Empty List State */
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400 px-6 text-center">
            <AlertCircle className="h-10 w-10 text-slate-300" />
            <div>
              <p className="text-sm font-semibold text-slate-700">Nenhuma pendência ativa</p>
              <p className="text-xs text-slate-500 mt-1">
                Todas as tarefas estão em dia. Clique em &quot;Adicionar&quot; para registrar um novo impedimento.
              </p>
            </div>
          </div>
        ) : (
          /* Pendency List */
          <div className="divide-y divide-slate-100">
            {pendencias.map((item) => {
              const dateFormatted = item.created_at ? new Date(item.created_at).toLocaleDateString() : "";
              const limitFormatted = item.data_limite
                ? new Date(item.data_limite + "T12:00:00").toLocaleDateString()
                : "";

              return (
                <div key={item.id} className="p-5 flex flex-col gap-3 hover:bg-slate-50/40 transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <h4 className="text-sm font-bold text-slate-900 break-words">{item.titulo}</h4>
                      <p className="text-xs text-slate-500 font-medium">
                        Por: {item.criado_por_nome} | {dateFormatted}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {getStatusBadge(item.status)}
                      {getPriorityBadge(item.prioridade)}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    {item.descricao}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 flex-wrap gap-2">
                    <span className="font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      Setor: {item.responsavel_setor}
                    </span>
                    {limitFormatted && (
                      <span className="inline-flex items-center gap-1 text-orange-600 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded font-bold">
                        <Calendar className="h-3 w-3" /> Prazo: {limitFormatted}
                      </span>
                    )}
                  </div>

                  {/* Resolution Detail (if completed or cancelled) */}
                  {(item.status === "CONCLUIDA" || item.status === "CANCELADA") && (
                    <div className="text-[10px] text-slate-400 mt-1 border-t border-slate-100 pt-2 flex flex-col gap-0.5">
                      {item.status === "CONCLUIDA" && (
                        <p>
                          ✓ Concluída por <strong>{item.concluido_por_nome}</strong> em{" "}
                          {item.concluido_at ? new Date(item.concluido_at).toLocaleString() : ""}
                        </p>
                      )}
                      {item.status === "CANCELADA" && (
                        <p>
                          ✕ Cancelada por <strong>{item.cancelado_por_nome}</strong> em{" "}
                          {item.cancelado_at ? new Date(item.cancelado_at).toLocaleString() : ""}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  {(item.status === "ABERTA" || item.status === "EM_ANDAMENTO") && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100/50">
                      {item.status === "ABERTA" && (
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(item.id, "EM_ANDAMENTO", item.titulo)}
                          className="inline-flex items-center gap-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 px-2.5 py-1 text-[10px] font-bold hover:bg-indigo-100 transition"
                        >
                          <Play className="h-3 w-3" /> Iniciar
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(item.id, "CONCLUIDA", item.titulo)}
                        className="inline-flex items-center gap-1 rounded bg-green-50 border border-green-200 text-green-700 px-2.5 py-1 text-[10px] font-bold hover:bg-green-100 transition ml-auto"
                      >
                        <CheckCircle2 className="h-3 w-3 text-green-600" /> Concluir
                      </button>

                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(item.id, "CANCELADA", item.titulo)}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 border border-slate-200 text-slate-600 px-2.5 py-1 text-[10px] font-bold hover:bg-slate-200 transition"
                      >
                        <XCircle className="h-3 w-3 text-slate-500" /> Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
