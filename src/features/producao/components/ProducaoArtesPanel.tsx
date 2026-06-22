// COMPONENT: src/features/producao/components/ProducaoArtesPanel.tsx
// Descrição: Painel operacional para acompanhamento e upload/versionamento de artes por modelo de pedido com controle de status real

"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import {
  listarModelosPorPedido,
  listarArtesPorModelo,
  uploadNovaVersaoArte,
  atualizarStatusArte
} from "../services/producao-artes.service";
import type { PedidoModelo, PedidoArte, StatusArteProducao } from "../types";
import {
  Upload,
  Download,
  History,
  FileText,
  User,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  Settings,
  MessageSquare
} from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";

interface ProducaoArtesPanelProps {
  idInt: number;
  idCliente?: number | null;
}

export function ProducaoArtesPanel({ idInt, idCliente }: ProducaoArtesPanelProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  
  const [modelos, setModelos] = useState<PedidoModelo[]>([]);
  const [artesPorModelo, setArtesPorModelo] = useState<Record<string, PedidoArte[]>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingModelId, setUploadingModelId] = useState<string | null>(null);
  const [expandedHistories, setExpandedHistories] = useState<Record<string, boolean>>({});
  
  // Estados para controle de mudança de status de arte com comentário
  const [selectedArteToChange, setSelectedArteToChange] = useState<{
    idArte: string;
    idModelo: string;
    nomeModelo: string;
    versao: number;
    currentStatus: StatusArteProducao;
  } | null>(null);
  const [newStatus, setNewStatus] = useState<StatusArteProducao>("PENDENTE");
  const [statusComment, setStatusComment] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Carrega modelos e suas respectivas artes do Supabase
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const modelosData = await listarModelosPorPedido(idInt);
      setModelos(modelosData);

      const artesMap: Record<string, PedidoArte[]> = {};
      for (const mod of modelosData) {
        try {
          const artesData = await listarArtesPorModelo(mod.id);
          artesMap[mod.id] = artesData;
        } catch (err) {
          console.error(`Erro ao carregar artes para o modelo ${mod.id}:`, err);
          artesMap[mod.id] = [];
        }
      }
      setArtesPorModelo(artesMap);
    } catch (err) {
      console.error("[ProducaoArtesPanel] Erro ao carregar dados:", err);
      showToast({
        type: "error",
        title: "Erro ao carregar dados",
        description: err instanceof Error ? err.message : "Falha na comunicação com o banco de dados."
      });
    } finally {
      setLoading(false);
    }
  }, [idInt, showToast]);

  useEffect(() => {
    let active = true;
    if (idInt) {
      const timer = setTimeout(() => {
        if (active) {
          void loadData();
        }
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [idInt, loadData]);

  // Manipulador de upload de arquivo de arte
  async function handleFileUpload(modeloId: string, nomeModelo: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limite de 10MB
    if (file.size > 10 * 1024 * 1024) {
      showToast({
        type: "warning",
        title: "Arquivo muito grande",
        description: "O tamanho limite de upload para o bucket é de 10MB."
      });
      e.target.value = "";
      return;
    }

    setUploadingModelId(modeloId);
    showToast({
      type: "info",
      title: "Enviando arquivo...",
      description: `Subindo arquivo de arte para o modelo "${nomeModelo}".`
    });

    try {
      const operadorNome = user?.name || user?.email || "Operador";
      const operadorUid = user?.id || null;

      const res = await uploadNovaVersaoArte({
        idInt,
        idModelo: modeloId,
        nomeModelo,
        file,
        autorUid: operadorUid,
        autorNome: operadorNome,
        autorEmail: user?.email || null,
        idCliente: idCliente || null,
        statusInicial: "EM_REVISAO_INTERNA" // Inicial operacional preferencial
      });

      if (!res.success) {
        throw new Error(res.errorMessage || "Erro durante o upload do arquivo.");
      }

      showToast({
        type: "success",
        title: "Arte enviada!",
        description: "Nova versão registrada e status do modelo atualizado para EM REVISÃO INTERNA."
      });

      await loadData();
    } catch (err) {
      console.error("[ProducaoArtesPanel] Falha no upload:", err);
      showToast({
        type: "error",
        title: "Erro no upload",
        description: err instanceof Error ? err.message : "Erro desconhecido durante o upload."
      });
    } finally {
      setUploadingModelId(null);
      e.target.value = "";
    }
  }

  // Atualiza o status da arte
  async function handleStatusChangeSubmit() {
    if (!selectedArteToChange) return;
    
    setUpdatingStatus(true);
    try {
      const operadorNome = user?.name || user?.email || "Operador";
      const operadorUid = user?.id || null;

      await atualizarStatusArte({
        idInt,
        idModelo: selectedArteToChange.idModelo,
        nomeModelo: selectedArteToChange.nomeModelo,
        idArte: selectedArteToChange.idArte,
        versao: selectedArteToChange.versao,
        novoStatus: newStatus,
        comentariosRevisao: statusComment.trim() || null,
        autorNome: operadorNome,
        autorUid: operadorUid,
        autorEmail: user?.email || null,
        idCliente: idCliente || null
      });

      showToast({
        type: "success",
        title: "Status Atualizado",
        description: `O status da arte (v${selectedArteToChange.versao}) foi alterado para ${newStatus}.`
      });

      setSelectedArteToChange(null);
      setStatusComment("");
      await loadData();
    } catch (err) {
      console.error("[ProducaoArtesPanel] Erro ao atualizar status da arte:", err);
      showToast({
        type: "error",
        title: "Erro ao atualizar",
        description: err instanceof Error ? err.message : "Falha na comunicação com o banco de dados."
      });
    } finally {
      setUpdatingStatus(false);
    }
  }

  function toggleHistory(modeloId: string) {
    setExpandedHistories((prev) => ({
      ...prev,
      [modeloId]: !prev[modeloId]
    }));
  }

  // Helper para mapear tons de status da arte e produção
  function getArteStatusTone(status: StatusArteProducao): "neutral" | "danger" | "warning" | "success" | "info" {
    switch (status) {
      case "PENDENTE":
        return "neutral";
      case "EM_CRIACAO":
      case "EM_REVISAO_INTERNA":
        return "info";
      case "AGUARDANDO_CLIENTE":
        return "warning";
      case "REPROVADA_CLIENTE":
        return "danger";
      case "APROVADA_CLIENTE":
      case "LIBERADA":
      case "IMPRESSA":
        return "success";
      case "NAO_NECESSARIA":
        return "neutral";
      default:
        return "neutral";
    }
  }

  if (loading && modelos.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          <p className="text-sm font-medium text-slate-500">Carregando modelos e artes da produção...</p>
        </div>
      </div>
    );
  }

  if (modelos.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-350 bg-slate-50 p-8 text-center">
        <FileText className="mx-auto h-12 w-12 text-slate-400" />
        <h3 className="mt-4 text-base font-semibold text-slate-900">Ainda sem modelos/lotes cadastrados</h3>
        <p className="mt-2 text-sm text-slate-500">Esta proposta/pedido ainda não possui modelos de produção vinculados.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Modal / Seção de Mudança de Status */}
      {selectedArteToChange && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm space-y-4 animate-in fade-in duration-200">
          <div className="flex justify-between items-center">
            <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Settings className="h-4.5 w-4.5 text-amber-500" />
              <span>Atualizar Status da Arte (v{selectedArteToChange.versao}) — Modelo: {selectedArteToChange.nomeModelo}</span>
            </h4>
            <button
              onClick={() => {
                setSelectedArteToChange(null);
                setStatusComment("");
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-700 transition"
            >
              Cancelar
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Novo Status da Arte:</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as StatusArteProducao)}
                className="w-full h-9 px-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="PENDENTE">PENDENTE</option>
                <option value="EM_CRIACAO">EM CRIACAO</option>
                <option value="EM_REVISAO_INTERNA">EM REVISAO INTERNA</option>
                <option value="AGUARDANDO_CLIENTE">AGUARDANDO CLIENTE</option>
                <option value="REPROVADA_CLIENTE">REPROVADA CLIENTE</option>
                <option value="APROVADA_CLIENTE">APROVADA CLIENTE</option>
                <option value="LIBERADA">LIBERADA (Pronto para Chão de Fábrica)</option>
                <option value="IMPRESSA">IMPRESSA</option>
                <option value="NAO_NECESSARIA">NAO NECESSARIA</option>
              </select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase block">Observações / Comentários da Revisão (Opcional):</label>
              <div className="flex gap-2">
                <textarea
                  value={statusComment}
                  onChange={(e) => setStatusComment(e.target.value)}
                  placeholder="Ex: Arte com tamanho correto, cores validadas. Ou detalhes da reprovação..."
                  className="flex-1 h-16 p-3 border border-slate-200 bg-white rounded-xl text-xs resize-none focus:outline-none focus:ring-1 focus:ring-slate-300 text-slate-850"
                />
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={handleStatusChangeSubmit}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 rounded-xl transition flex items-center justify-center shrink-0 self-end h-10 shadow-sm disabled:opacity-50"
                >
                  {updatingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {modelos.map((modelo) => {
          const artes = artesPorModelo[modelo.id] || [];
          const arteAtual: any = artes[0]; // Ordenado por versao desc
          const historico = artes.slice(1);
          const isHistoryOpen = !!expandedHistories[modelo.id];

          return (
            <section
              key={modelo.id}
              className="rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              {/* Modelo Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-slate-900">{modelo.nome_modelo}</h3>
                    <StatusBadge status={modelo.status_arte} tone={getArteStatusTone(modelo.status_arte)} />
                  </div>
                  {modelo.descricao && (
                    <p className="mt-1 text-sm text-slate-500">{modelo.descricao}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold text-slate-600">
                    <span>Qtd: <strong className="text-slate-900">{modelo.quantidade} un.</strong></span>
                    {modelo.tipo_numeracao && modelo.tipo_numeracao !== "SEM_NUMERACAO" && (
                      <span>Numeração: <strong className="text-slate-900">{modelo.tipo_numeracao} {modelo.numeracao_inicio !== null ? `(${modelo.numeracao_inicio} - ${modelo.numeracao_fim})` : ""}</strong></span>
                    )}
                    <span>Produção: <strong className="text-slate-900">{modelo.status_producao}</strong></span>
                    {modelo.obs_impressao && (
                      <span className="text-amber-700 italic">Obs: &quot;{modelo.obs_impressao}&quot;</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className={`relative flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 ${uploadingModelId === modelo.id ? "opacity-50 cursor-not-allowed" : ""}`}>
                    {uploadingModelId === modelo.id ? (
                      <>
                        <Loader2 className="h-4.5 w-4.5 animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-4.5 w-4.5" />
                        <span>Upload Nova Versão</span>
                      </>
                    )}
                    <input
                      type="file"
                      disabled={uploadingModelId === modelo.id}
                      onChange={(e) => void handleFileUpload(modelo.id, modelo.nome_modelo, e)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      accept=".pdf,.png,.jpg,.jpeg,.ai,.zip"
                    />
                  </label>
                </div>
              </div>

              {/* Informações da Arte Atual */}
              <div className="mt-4">
                {arteAtual ? (
                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-xl bg-blue-50 p-2.5 text-blue-600">
                          <FileText className="h-5 w-5" />
                        </span>
                        <div>
                          <p className="font-semibold text-slate-900 break-all">{arteAtual.nome_arquivo}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-500 font-medium">Versão {arteAtual.versao}</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300"></span>
                            <span className="text-xs text-slate-500 font-medium">Status: <strong>{arteAtual.status}</strong></span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5 font-medium"><User className="h-3.5 w-3.5" /> {arteAtual.enviado_por || "Sistema"}</span>
                            <span className="flex items-center gap-1.5 font-medium"><Calendar className="h-3.5 w-3.5" /> {new Date(arteAtual.created_at).toLocaleDateString()}</span>
                            {arteAtual.tamanho_bytes !== null && (
                              <span className="font-medium">{(arteAtual.tamanho_bytes / 1024 / 1024).toFixed(2)} MB</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedArteToChange({
                              idArte: arteAtual.id,
                              idModelo: modelo.id,
                              nomeModelo: modelo.nome_modelo,
                              versao: arteAtual.versao ?? 1,
                              currentStatus: arteAtual.status
                            });
                            setNewStatus(arteAtual.status);
                            setStatusComment(arteAtual.comentarios_revisao || "");
                          }}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          <Settings className="h-4 w-4 text-slate-500" />
                          Alterar Status
                        </button>
                        {arteAtual.url_arquivo && (
                          <a
                            href={arteAtual.url_arquivo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 px-3 py-2 text-xs font-bold shadow-sm transition hover:bg-blue-100"
                          >
                            <Download className="h-4 w-4" />
                            Visualizar Arquivo
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Comentários de Revisão da Arte Atual */}
                    {arteAtual.comentarios_revisao && (
                      <div className="mt-3 rounded-xl bg-amber-50/50 border border-amber-100 p-3 text-xs text-amber-800 flex items-start gap-2">
                        <MessageSquare className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                        <div>
                          <strong className="font-bold block mb-0.5">Observações / Comentários:</strong>
                          {arteAtual.comentarios_revisao}
                        </div>
                      </div>
                    )}

                    {/* Dados de Aprovação do Cliente */}
                    {arteAtual.status === "APROVADA_CLIENTE" && (
                      <div className="mt-3 rounded-xl bg-emerald-50/50 border border-emerald-100 p-3 text-xs text-emerald-700 flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                        <div>
                          <strong className="font-semibold block mb-0.5">Aprovado pelo Cliente:</strong>
                          Aprovado por {arteAtual.aprovado_por || "Cliente"} {arteAtual.data_aprovacao ? `em ${new Date(arteAtual.data_aprovacao).toLocaleString()}` : ""}.
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500 flex flex-col items-center justify-center">
                    <Clock className="h-8 w-8 text-slate-400 mb-2" />
                    <span>Nenhuma arte enviada</span>
                  </div>
                )}
              </div>

              {/* Histórico de Versões Anteriores */}
              {historico.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => toggleHistory(modelo.id)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition"
                  >
                    <History className="h-3.5 w-3.5" />
                    <span>Histórico de versões ({historico.length})</span>
                    {isHistoryOpen ? <ChevronUp className="h-4.5 w-4.5" /> : <ChevronDown className="h-4.5 w-4.5" />}
                  </button>

                  {isHistoryOpen && (
                    <div className="mt-3 space-y-2 pl-2 border-l-2 border-slate-100 animate-in fade-in slide-in-from-top-1 duration-200">
                      {historico.map((art: any) => (
                        <div
                          key={art.id}
                          className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/30 p-2.5 border border-slate-100 text-xs transition hover:bg-slate-50"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-slate-700 shrink-0">v{art.versao}</span>
                            <span className="text-slate-500 truncate" title={art.nome_arquivo ?? undefined}>{art.nome_arquivo}</span>
                            <span className="text-slate-400 font-medium shrink-0">• {new Date(art.created_at).toLocaleDateString()}</span>
                            <span className="font-semibold shrink-0">({art.status})</span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {art.url_arquivo && (
                              <a
                                href={art.url_arquivo}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 transition"
                                title="Download versão anterior"
                              >
                                <Download className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
