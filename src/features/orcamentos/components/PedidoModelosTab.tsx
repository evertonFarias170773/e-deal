"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, Package, CheckCircle, Copy, Image as ImageIcon, AlertOctagon, ChevronDown } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import type { PedidoModeloRow, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  atualizarModeloParcial,
  excluirModelo,
} from "@/features/orcamentos/services/pedidos-modelos.service";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { PropostaItem, PedidoModeloState } from "@/features/orcamentos/types";

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition";
const labelClass = "text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1";

// ─── Component ───────────────────────────────────────────────────────────────

function ModeloInlineCard({
  modelo,
  maxQtd,
  itemIdModeloCorNum,
  itemIdFormato,
  produtoIdFormato,
  coresOpcoes,
  numeracoesOpcoes,
  formatosOpcoes,
  onRemove,
  onClose,
  onUpdateParent,
}: {
  modelo: PedidoModeloState;
  maxQtd: number;
  itemIdModeloCorNum?: string | null;
  itemIdFormato?: string | null;
  produtoIdFormato?: string | null;
  coresOpcoes: any[];
  numeracoesOpcoes: any[];
  formatosOpcoes: any[];
  onRemove: () => void;
  onClose: () => void;
  onUpdateParent: (partial: Partial<PedidoModeloState>) => void;
}) {
  const isNew = !modelo.isPersisted;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Default numeracao_inicio to 1 if new and not set
  useEffect(() => {
    if (isNew && modelo.numeracao_inicio == null) {
      onUpdateParent({ numeracao_inicio: 1 });
    }
  }, [isNew, modelo.numeracao_inicio, onUpdateParent]);

  // Numeracao_fim calculation
  useEffect(() => {
    if (modelo.tipo_numeracao !== "SEM_NUMERACAO" && modelo.quantidade && modelo.numeracao_inicio !== null) {
      const start = Number(modelo.numeracao_inicio);
      const qty = Number(modelo.quantidade);
      if (!isNaN(start) && !isNaN(qty) && qty > 0) {
        const expectedFim = start + qty - 1;
        if (modelo.numeracao_fim !== expectedFim) {
          onUpdateParent({ numeracao_fim: expectedFim });
        }
      }
    }
  }, [modelo.quantidade, modelo.numeracao_inicio, modelo.tipo_numeracao, modelo.numeracao_fim, onUpdateParent]);

  const handleChange = (partial: Partial<PedidoModeloState>) => {
    onUpdateParent(partial);
  };

  const handleBlur = () => {
    if (isNew) return;
    // On blur we can trigger a partial save if needed.
    // In our simplified logic, if isPersisted, we can do partial save debounced or onBlur
    // Here we'll rely on the parent debounce or just do it inline here:
    const draftId = modelo.id;
    if (draftId && draftId > 0) {
       setSaveStatus("saving");
       atualizarModeloParcial(draftId, {
         nome_modelo: modelo.nome_modelo,
         padrao: modelo.padrao || null,
         quantidade: modelo.quantidade,
         tipo_numeracao: modelo.tipo_numeracao || null,
         numeracao_inicio: modelo.numeracao_inicio || null,
         numeracao_fim: modelo.numeracao_fim || null,
         verso_tipo: modelo.verso_tipo || null,
       }).then(res => {
         if(res.success) {
           setSaveStatus("saved");
           setTimeout(() => setSaveStatus("idle"), 2000);
         } else {
           setSaveStatus("error");
         }
       });
    }
  };

  const hasConfig = Boolean(itemIdFormato);

  const filteredCores = hasConfig ? coresOpcoes.filter((c) => {
    return String(c.formato_id) === String(itemIdFormato);
  }) : [];

  const filteredNum = (produtoIdFormato && formatosOpcoes) ? formatosOpcoes.filter((f) => {
    return String(f.id_formato_num) === String(produtoIdFormato);
  }) : [];

  return (
    <div className="relative rounded-2xl border-2 border-teal-500 bg-teal-50/30 p-5 shadow-sm transition-all" onBlur={handleBlur}>
      <div className="mb-4 flex items-center justify-between border-b border-teal-100 pb-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-bold text-teal-800">
            {isNew ? "Novo modelo" : `Modelo #${modelo.id}`}
          </h4>
          {!isNew && (
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {saveStatus === "idle" && <span className="flex h-2 w-2 rounded-full bg-slate-300" title="Sem alterações pendentes"></span>}
              {saveStatus === "saving" && <span className="text-amber-600">Salvando...</span>}
              {saveStatus === "saved" && <span className="text-teal-600">Salvo</span>}
              {saveStatus === "error" && <span className="text-red-500">Erro ao salvar</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Fechar
          </button>
          <button
            onClick={onRemove}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100"
          >
            {isNew ? "Cancelar" : "Remover"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap xl:flex-nowrap xl:items-end gap-3">
        <div className="flex-[2] min-w-[120px]">
          <label className={labelClass}>Modelo *</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Ex: Talão"
            value={modelo.nome_modelo}
            onChange={(e) => handleChange({ nome_modelo: e.target.value })}
          />
        </div>

        <div className="flex-[1.5] min-w-[110px]">
          <label className={labelClass}>Cor papel *</label>
            <select
              className={inputClass}
              value={modelo.padrao || ""}
              onChange={(e) => handleChange({ padrao: e.target.value })}
              disabled={!hasConfig}
            >
              {!hasConfig ? (
                <option value="">Sem formato</option>
              ) : (
              <>
                <option value="">Selecione...</option>
                {filteredCores.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </>
              )}
            </select>
        </div>

        <div className="flex-[1] min-w-[70px]">
          <label className={labelClass}>Qtd *</label>
          <input
            type="number"
            className={inputClass}
            value={modelo.quantidade || ""}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (!isNaN(val)) {
                handleChange({ quantidade: Math.min(val, maxQtd) });
              }
            }}
          />
        </div>

        <div className="flex-[1.5] min-w-[120px]">
          <label className={labelClass}>Numerador</label>
          <select
            className={inputClass}
            value={modelo.tipo_numeracao || ""}
            onChange={(e) => handleChange({ tipo_numeracao: e.target.value })}
            disabled={!hasConfig}
          >
            {!hasConfig ? (
              <option value="">Sem formato</option>
            ) : (
              <>
                <option value="SEM_NUMERACAO">Sem Numeração</option>
                {filteredNum.map((n) => (
                  <option key={n.id} value={n.name}>{n.name}</option>
                ))}
              </>
            )}
          </select>
        </div>

        <div className="flex-[1] min-w-[80px]">
          <label className={labelClass}>Nº Inicial</label>
          <input
            type="number"
            className={inputClass}
            placeholder="Ex: 1"
            value={modelo.numeracao_inicio ?? ""}
            onChange={(e) => handleChange({ numeracao_inicio: Number(e.target.value) || null })}
            disabled={!modelo.tipo_numeracao || modelo.tipo_numeracao === "SEM_NUMERACAO"}
          />
        </div>

        <div className="flex-[1] min-w-[80px]">
          <label className={labelClass}>Nº Final</label>
          <input
            type="number"
            className={`${inputClass} bg-slate-50`}
            placeholder="Automático"
            value={modelo.numeracao_fim ?? ""}
            readOnly
            disabled={!modelo.tipo_numeracao || modelo.tipo_numeracao === "SEM_NUMERACAO"}
          />
        </div>

        <div className="flex-[1.5] min-w-[110px]">
          <label className={labelClass}>Verso</label>
          <select
            className={inputClass}
            value={modelo.verso_tipo || ""}
            onChange={(e) => handleChange({ verso_tipo: e.target.value })}
          >
            <option value="SÓ FRENTE">SÓ FRENTE</option>
            <option value="FRENTE E VERSO">FRENTE E VERSO</option>
            <option value="VERSO FIXO">VERSO FIXO</option>
            <option value="VERSO VARIÁVEL">VERSO VARIÁVEL</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function PedidoModelosTab({
  itens,
  modelos,
  onModelosChange,
}: {
  itens: PropostaItem[];
  modelos: PedidoModeloState[];
  onModelosChange: (m: PedidoModeloState[]) => void;
}) {
  const { showToast } = useAppToast();
  const [loading, setLoading] = useState(false);
  const [coresOpcoes, setCoresOpcoes] = useState<any[]>([]);
  const [numeracoesOpcoes, setNumeracoesOpcoes] = useState<any[]>([]);
  const [formatosOpcoes, setFormatosOpcoes] = useState<any[]>([]);
  const [deletingModelo, setDeletingModelo] = useState<PedidoModeloState | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [openModelos, setOpenModelos] = useState<Record<string, boolean>>({});

  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);

  async function openPreview(corName: string) {
    if (!corName) {
      showToast({ type: "error", title: "Erro", description: "O modelo não possui cor definida." });
      return;
    }
    setPreviewModalOpen(true);
    setPreviewLoading(true);
    setPreviewBase64(null);
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data } = await supabase.from("producao_cores").select("pdf_base64").eq("name", corName).single();
        if (data && data.pdf_base64) {
          setPreviewBase64(data.pdf_base64);
        }
      }
    } catch (err) {
      console.error(err);
    }
    setPreviewLoading(false);
  }

  const fetchOpcoes = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const [resFormatos, resCores, resNum] = await Promise.all([
      supabase.from("producao_formatos").select("id, name, id_formato_num"),
      supabase.from("producao_cores").select("id, name, formato_id, id_modelo_cor_num").order("id_modelo_cor_num", { ascending: true }),
      supabase.from("producao_numeracoes").select("id, name, formato_id, formato_ids, id_modelo_cor_num").order("name", { ascending: true }),
    ]);

    if (resFormatos.data) setFormatosOpcoes(resFormatos.data);
    if (resCores.data) setCoresOpcoes(resCores.data);
    if (resNum.data) setNumeracoesOpcoes(resNum.data);
  }, []);

  useEffect(() => {
    void fetchOpcoes();
  }, [fetchOpcoes]);

  // ─── Inline Actions ────────────────────────────────────────────────────────

  function startCreate(item: PropostaItem, maxQtd: number) {
    if (maxQtd <= 0) {
      showToast({ type: "error", title: "Ação bloqueada", description: "Não há saldo disponível para adicionar novo modelo." });
      return;
    }

    const newId = `new_${Date.now()}`;
    const newModel: PedidoModeloState = {
      tempId: newId,
      isPersisted: false,
      id_produto_proposta_origem: item.id_produto_proposta_origem || null,
      id_item: item.id,
      nome_modelo: "",
      descricao: null,
      padrao: null,
      quantidade: maxQtd,
      tipo_numeracao: "SEM_NUMERACAO",
      numeracao_inicio: null,
      numeracao_fim: null,
      verso_tipo: "SÓ FRENTE",
    };

    onModelosChange([...modelos, newModel]);
    setCollapsedItems((prev) => ({ ...prev, [item.id]: false }));
    setOpenModelos((prev) => ({ ...prev, [newId]: true }));
  }

  function startCopy(modelo: PedidoModeloState) {
    const newId = `new_${Date.now()}`;
    const newModel: PedidoModeloState = {
      ...modelo,
      id: undefined,
      tempId: newId,
      isPersisted: false,
    };
    onModelosChange([...modelos, newModel]);
    setOpenModelos((prev) => ({ ...prev, [newId]: true }));
  }

  async function handleDeleteConfirm() {
    if (!deletingModelo) return;
    
    if (deletingModelo.isPersisted && deletingModelo.id) {
      const result = await excluirModelo(deletingModelo.id);
      if (result.success) {
        showToast({ type: "success", title: "Excluído", description: "Modelo removido com sucesso." });
        onModelosChange(modelos.filter((m) => m.id !== deletingModelo.id));
      } else {
        showToast({ type: "error", title: "Erro", description: result.errorMessage || "Falha ao excluir." });
      }
    } else {
      onModelosChange(modelos.filter((m) => m.tempId !== deletingModelo.tempId));
    }
    
    setDeleteConfirmOpen(false);
    setDeletingModelo(null);
  }

  // ─── Renders ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-500"></div>
      </div>
    );
  }

  if (!itens || itens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Package className="mb-4 h-16 w-16 text-slate-300" />
        <h3 className="text-lg font-bold text-slate-700">Nenhum produto encontrado</h3>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          Você precisa adicionar produtos (blocos, cadernos, etc) na aba &quot;Produtos&quot; para depois configurar seus modelos de impressão (Artes/Lotes) aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-[#0b2f4a]">Boletim Técnico & Lotes</h2>
        <p className="text-sm text-slate-500">
          Distribua a quantidade de cada produto em modelos de impressão e defina regras de numeração/vias.
        </p>
      </div>

      <div className="space-y-6">
        {itens.map((item) => {
          const modelosDoItem = modelos.filter(
            (m) =>
              (m.id_produto_proposta_origem && item.id_produto_proposta_origem && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
              (m.id_item && item.id && m.id_item === item.id)
          );
          
          const qtyUsed = modelosDoItem.reduce((acc, m) => acc + (m.quantidade || 0), 0);
          const saldo = (item.quantidade || 0) - qtyUsed;
          const isFull = saldo <= 0;

          return (
            <div key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/50 p-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setCollapsedItems(prev => ({...prev, [item.id]: !prev[item.id]}))}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-100 text-teal-600 transition hover:bg-teal-200"
                  >
                    <ChevronDown className={`h-5 w-5 transition-transform ${collapsedItems[item.id] ? "-rotate-90" : ""}`} />
                  </button>
                  <div>
                    <h3 className="font-bold text-slate-800">{item.nome}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Qtd: {item.quantidade}</span>
                      <span className={saldo > 0 ? "text-amber-600" : "text-teal-600"}>
                        {saldo > 0 ? `Restam: ${saldo}` : "Saldo distribuído 100%"}
                      </span>
                      {item.descricaoModelo && <span className="max-w-[200px] truncate">Ref: {item.descricaoModelo}</span>}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => startCreate(item, saldo)}
                  disabled={isFull}
                  className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar modelo
                </button>
              </div>

              {!collapsedItems[item.id] && (
                <div className="p-5 space-y-4 bg-slate-50/30">
                {modelosDoItem.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-8 text-center bg-white">
                    <CheckCircle className="mb-2 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-bold text-slate-600">Nenhum modelo configurado</p>
                    <p className="mt-1 text-xs text-slate-500">Clique em &quot;Adicionar modelo&quot; para configurar.</p>
                  </div>
                )}

                {modelosDoItem.map((m) => {
                  const numFormatId = item.produto?.id_formato;
                  const formatoObj = formatosOpcoes.find(f => String(f.id_formato_num) === String(numFormatId) || String(f.id) === String(numFormatId));
                  const realFormatoUUID = formatoObj ? formatoObj.id : null;
                  
                  const modId = m.tempId || String(m.id);
                  const isOpen = openModelos[modId];

                  if (isOpen) {
                    return (
                      <ModeloInlineCard
                        key={modId}
                        modelo={m}
                        maxQtd={saldo + (m.quantidade || 0)}
                        itemIdModeloCorNum={item.produto?.id_modelo_cor?.toString()}
                        itemIdFormato={realFormatoUUID}
                        produtoIdFormato={item.produto?.id_formato?.toString()}
                        coresOpcoes={coresOpcoes}
                        numeracoesOpcoes={numeracoesOpcoes}
                        formatosOpcoes={formatosOpcoes}
                        onRemove={() => {
                           setDeletingModelo(m);
                           setDeleteConfirmOpen(true);
                        }}
                        onClose={() => setOpenModelos((prev) => ({ ...prev, [modId]: false }))}
                        onUpdateParent={(partial) => {
                           const updated = modelos.map(mod => {
                             if (m.tempId && mod.tempId === m.tempId) return { ...mod, ...partial };
                             if (m.id && mod.id === m.id) return { ...mod, ...partial };
                             return mod;
                           });
                           onModelosChange(updated);
                        }}
                      />
                    );
                  }

                  return (
                    <div key={modId} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
                      <div className="mb-3 pr-24">
                        <h4 className="text-base font-bold text-[#0b2f4a]">{m.nome_modelo || "Modelo sem nome"}</h4>
                        <div className="mt-2 flex flex-wrap gap-2 text-sm font-medium text-slate-600">
                          <span className="rounded bg-slate-100 px-2.5 py-1">Qtd: {m.quantidade}</span>
                          {m.padrao && <span className="rounded bg-slate-100 px-2.5 py-1">Cor: {m.padrao}</span>}
                          {m.tipo_numeracao && m.tipo_numeracao !== "SEM_NUMERACAO" && (
                            <span className="rounded bg-slate-100 px-2.5 py-1">Numeração: {m.tipo_numeracao} ({m.numeracao_inicio || 0} a {m.numeracao_fim || 0})</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="absolute right-4 top-4 flex gap-2">
                        <div className="flex items-center gap-2">
                          {m.padrao && (
                            <button
                              type="button"
                              onClick={() => openPreview(m.padrao || "")}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                              title="Visualizar Arte"
                            >
                              <ImageIcon className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setOpenModelos((prev) => ({ ...prev, [modId]: true }))}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-blue-500 transition hover:bg-blue-50 hover:text-blue-600"
                            title="Editar Modelo"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startCopy(m)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                            title="Duplicar Modelo"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingModelo(m);
                              setDeleteConfirmOpen(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-red-400 transition hover:bg-red-50 hover:text-red-600"
                            title="Remover Modelo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {deleteConfirmOpen && deletingModelo && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md scale-100 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-4 text-red-600">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100">
                <AlertOctagon className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Excluir modelo?</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              Tem certeza que deseja excluir o modelo <strong>{deletingModelo.nome_modelo}</strong>?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirmOpen(false)} className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteConfirm} className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700">
                Sim, excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {previewModalOpen && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl scale-100 rounded-3xl bg-white p-6 shadow-2xl text-center flex flex-col max-h-[90vh]">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Pré-visualização da Arte</h3>
            <div className="flex-1 min-h-[400px] mb-6 bg-slate-100 rounded-xl overflow-hidden flex items-center justify-center relative">
              {previewLoading ? (
                 <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-[#0b2f4a]"></div>
              ) : previewBase64 ? (
                 <iframe 
                   src={previewBase64.startsWith("data:") ? previewBase64 : `data:application/pdf;base64,${previewBase64}`} 
                   className="w-full h-full border-0 absolute inset-0"
                   title="PDF Preview"
                 />
              ) : (
                 <div className="flex flex-col items-center text-slate-400">
                    <ImageIcon className="h-10 w-10 mb-2 opacity-50" />
                    <p className="text-sm">Arte não encontrada para este papel.</p>
                 </div>
              )}
            </div>
            <button
              onClick={() => setPreviewModalOpen(false)}
              className="w-full rounded-2xl bg-[#0b2f4a] px-4 py-3 font-semibold text-white transition hover:bg-[#123f61]"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
