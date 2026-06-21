"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, Package, CheckCircle, Copy, Image as ImageIcon, AlertOctagon, ChevronDown } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import type { PedidoModeloRow, ItemComModelos, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  listarItensComModelos,
  criarModelo,
  atualizarModelo,
  atualizarModeloParcial,
  excluirModelo,
} from "@/features/orcamentos/services/pedidos-modelos.service";
import { getSupabaseClient } from "@/lib/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ModeloDraft {
  id?: number | string; // string para novos modelos não salvos
  nome_modelo: string;
  padrao: string;
  quantidade: string;
  tipo_numeracao: string;
  numerador: string;
  numeracao_inicio: string;
  numeracao_fim: string;
  verso_tipo: string;
}

const EMPTY_DRAFT: ModeloDraft = {
  nome_modelo: "",
  padrao: "",
  quantidade: "",
  tipo_numeracao: "SEM_NUMERACAO",
  numerador: "",
  numeracao_inicio: "",
  numeracao_fim: "",
  verso_tipo: "SÓ FRENTE",
};

function draftFromModelo(m: PedidoModeloRow): ModeloDraft {
  return {
    id: m.id,
    nome_modelo: m.nome_modelo,
    padrao: m.padrao || "",
    quantidade: m.quantidade.toString(),
    tipo_numeracao: m.tipo_numeracao || "SEM_NUMERACAO",
    numerador: "", // Não persistido na base ainda conforme regra atual
    numeracao_inicio: m.numeracao_inicio !== null ? m.numeracao_inicio.toString() : "",
    numeracao_fim: m.numeracao_fim !== null ? m.numeracao_fim.toString() : "",
    verso_tipo: m.verso_tipo || "SÓ FRENTE",
  };
}

function draftToInput(draft: ModeloDraft, idInt: number, idProdutoProposta: number): ModeloInput {
  return {
    id_int: idInt,
    id_produto_proposta_origem: idProdutoProposta,
    nome_modelo: draft.nome_modelo.trim(),
    padrao: draft.padrao.trim() || null,
    quantidade: Number(draft.quantidade) || 0,
    tipo_numeracao: draft.tipo_numeracao || null,
    numeracao_inicio: draft.numeracao_inicio ? Number(draft.numeracao_inicio) : null,
    numeracao_fim: draft.numeracao_fim ? Number(draft.numeracao_fim) : null,
    verso_tipo: draft.verso_tipo,
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition";
const labelClass = "text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1";

// ─── Component ───────────────────────────────────────────────────────────────

function ModeloInlineCard({
  itemId,
  draft: initialDraft,
  maxQtd,
  itemIdModeloCorNum,
  itemIdFormato,
  coresOpcoes,
  numeracoesOpcoes,
  formatosOpcoes,
  saving,
  onCancel,
  onSaveNew,
  onPartialSave,
  onUpdateParent,
}: {
  itemId: number;
  draft: ModeloDraft;
  maxQtd: number;
  itemIdModeloCorNum?: string | null;
  itemIdFormato?: string | null;
  coresOpcoes: any[];
  numeracoesOpcoes: any[];
  formatosOpcoes: any[];
  saving: boolean;
  onCancel: () => void;
  onSaveNew: (draft: ModeloDraft) => void;
  onPartialSave: (draftId: number, partial: Partial<ModeloDraft>, setStatus: (s: any) => void) => void;
  onUpdateParent: (partial: Partial<ModeloDraft>) => void;
}) {
  const isNew = typeof initialDraft.id === "string";
  const [localDraft, setLocalDraft] = useState<ModeloDraft>(initialDraft);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Numeracao_fim calculation
  useEffect(() => {
    if (localDraft.tipo_numeracao === "SEQUENCIAL" && localDraft.quantidade && localDraft.numeracao_inicio) {
      const start = Number(localDraft.numeracao_inicio);
      const qty = Number(localDraft.quantidade);
      if (!isNaN(start) && !isNaN(qty) && qty > 0) {
        const expectedFim = String(start + qty - 1);
        if (localDraft.numeracao_fim !== expectedFim) {
          setLocalDraft((prev) => ({ ...prev, numeracao_fim: expectedFim }));
        }
      }
    }
  }, [localDraft.quantidade, localDraft.numeracao_inicio, localDraft.tipo_numeracao, localDraft.numeracao_fim]);

  const handleChange = (partial: Partial<ModeloDraft>) => {
    setLocalDraft((prev) => ({ ...prev, ...partial }));
    if (isNew) {
      onUpdateParent(partial);
    }
  };

  // Debounce para auto-save parcial
  useEffect(() => {
    if (isNew) return;
    
    const changedKeys = (Object.keys(localDraft) as (keyof ModeloDraft)[]).filter(k => localDraft[k] !== initialDraft[k]);
    if (changedKeys.length === 0) {
      if (saveStatus === "saved") {
         const t = setTimeout(() => setSaveStatus("idle"), 2000);
         return () => clearTimeout(t);
      }
      return;
    }

    setSaveStatus("saving");
    const timer = setTimeout(() => {
      const partialData: Partial<ModeloDraft> = {};
      changedKeys.forEach(k => {
         // @ts-ignore
         partialData[k] = localDraft[k];
      });
      onPartialSave(initialDraft.id as number, partialData, setSaveStatus);
    }, 1000);

    return () => clearTimeout(timer);
  }, [localDraft, initialDraft, isNew, onPartialSave, saveStatus]);

  const handleBlur = () => {
    if (isNew) return;
    const changedKeys = (Object.keys(localDraft) as (keyof ModeloDraft)[]).filter(k => localDraft[k] !== initialDraft[k]);
    if (changedKeys.length > 0) {
      setSaveStatus("saving");
      const partialData: Partial<ModeloDraft> = {};
      changedKeys.forEach(k => {
         // @ts-ignore
         partialData[k] = localDraft[k];
      });
      onPartialSave(initialDraft.id as number, partialData, setSaveStatus);
    }
  };

  const hasConfig = Boolean(itemIdModeloCorNum || itemIdFormato);

  const filteredCores = hasConfig ? coresOpcoes.filter((c) => {
    if (itemIdModeloCorNum && String(c.id_modelo_cor_num) === String(itemIdModeloCorNum)) return true;
    if (itemIdFormato && String(c.formato_id) === String(itemIdFormato)) return true;
    return false;
  }) : [];

  const filteredNum = hasConfig ? numeracoesOpcoes.filter((n) => {
    if (itemIdModeloCorNum && String(n.id_modelo_cor_num) === String(itemIdModeloCorNum)) return true;
    if (itemIdFormato && String(n.formato_id) === String(itemIdFormato)) return true;
    if (itemIdFormato && n.formato_ids && Array.isArray(n.formato_ids) && n.formato_ids.includes(String(itemIdFormato))) return true;
    return false;
  }) : [];

  return (
    <div className="relative rounded-2xl border-2 border-teal-500 bg-teal-50/30 p-5 shadow-sm transition-all" onBlur={handleBlur}>
      <div className="mb-4 flex items-center justify-between border-b border-teal-100 pb-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-bold text-teal-800">
            {isNew ? "Novo modelo" : `Modelo #${initialDraft.id}`}
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
            onClick={onCancel}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            {isNew ? "Cancelar" : "Fechar"}
          </button>
          {isNew && (
            <button
              onClick={() => onSaveNew(localDraft)}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-[2] min-w-[150px]">
          <label className={labelClass}>Modelo *</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Ex: Talão"
            value={localDraft.nome_modelo}
            onChange={(e) => handleChange({ nome_modelo: e.target.value })}
          />
        </div>

        <div className="flex-[1.5] min-w-[120px]">
          <label className={labelClass}>Cor papel *</label>
            <select
              className={inputClass}
              value={localDraft.padrao}
              onChange={(e) => handleChange({ padrao: e.target.value })}
              disabled={!hasConfig}
            >
              {!hasConfig ? (
                <option value="">Nenhuma configuração cadastrada para este produto.</option>
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

        <div className="w-full lg:w-24">
          <label className={labelClass}>
            Qtd <span className="text-teal-600 lowercase font-normal ml-1">({maxQtd})</span>
          </label>
          <input
            type="number"
            className={inputClass}
            min={1}
            max={maxQtd}
            value={localDraft.quantidade}
            onChange={(e) => {
              let val = Number(e.target.value);
              if (val > maxQtd) val = maxQtd;
              handleChange({ quantidade: val ? String(val) : "" });
            }}
          />
        </div>

        <div className="flex-[1.5] min-w-[120px]">
          <label className={labelClass}>Numerador</label>
            <select
              className={inputClass}
              value={localDraft.numerador}
              onChange={(e) => handleChange({ numerador: e.target.value })}
              disabled={!hasConfig}
            >
              {!hasConfig ? (
                <option value="">Nenhuma configuração cadastrada para este produto.</option>
              ) : (
              <>
                <option value="">Selecione...</option>
                {filteredNum.map((n) => (
                  <option key={n.id} value={n.name}>{n.name}</option>
                ))}
              </>
            )}
          </select>
        </div>

        <div className="flex-[1.5] min-w-[120px]">
          <label className={labelClass}>Verso</label>
          <select
            className={inputClass}
            value={localDraft.verso_tipo}
            onChange={(e) => handleChange({ verso_tipo: e.target.value })}
          >
            <option value="SÓ FRENTE">SÓ FRENTE</option>
            <option value="FRENTE E VERSO">FRENTE E VERSO</option>
            <option value="VERSO FIXO">VERSO FIXO</option>
            <option value="VERSO VARIÁVEL">VERSO VARIÁVEL</option>
          </select>
        </div>
      </div>

      {localDraft.tipo_numeracao === "SEQUENCIAL" && (
        <div className="mt-3 flex gap-3 p-3 bg-white rounded-xl border border-teal-100">
          <div>
            <label className={labelClass}>Nº Inicial *</label>
            <input
              type="number"
              className={inputClass}
              value={localDraft.numeracao_inicio}
              onChange={(e) => handleChange({ numeracao_inicio: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>Nº Final * (Auto)</label>
            <input
              type="number"
              className={`${inputClass} bg-slate-50`}
              value={localDraft.numeracao_fim}
              readOnly
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function PedidoModelosTab({ idInt }: { idInt: number }) {
  const { showToast } = useAppToast();
  const [itens, setItens] = useState<ItemComModelos[]>([]);
  const [loading, setLoading] = useState(true);

  // States para opções dinâmicas
  const [formatosOpcoes, setFormatosOpcoes] = useState<{ id: string; name: string }[]>([]);
  const [coresOpcoes, setCoresOpcoes] = useState<{ id: number; name: string; formato_id: string }[]>([]);
  const [numeracoesOpcoes, setNumeracoesOpcoes] = useState<{ id: number; name: string; formato_id: string; formato_ids: string[] | null }[]>([]);

  // State de edição inline: map de idProduto -> drafts em edição
  // Para permitir múltiplos drafts num mesmo produto, usamos um array.
  const [editingDrafts, setEditingDrafts] = useState<Record<number, ModeloDraft[]>>({});
  const [savingCards, setSavingCards] = useState<Record<string, boolean>>({});

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingModelo, setDeletingModelo] = useState<PedidoModeloRow | null>(null);
  const [collapsedItems, setCollapsedItems] = useState<Record<number, boolean>>({});

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

  const fetchData = useCallback(async () => {
    if (!idInt || idInt === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await listarItensComModelos(idInt);
    if (result.success && result.data) {
      setItens(result.data);
    } else {
      showToast({ type: "error", title: "Erro", description: result.errorMessage || "Falha ao carregar itens." });
    }
    setLoading(false);
  }, [idInt, showToast]);

  const fetchOpcoes = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const [resFormatos, resCores, resNum] = await Promise.all([
      supabase.from("producao_formatos").select("id, name"),
      supabase.from("producao_cores").select("id, name, formato_id, id_modelo_cor_num").order("id_modelo_cor_num", { ascending: true }),
      supabase.from("producao_numeracoes").select("id, name, formato_id, formato_ids, id_modelo_cor_num").order("name", { ascending: true }),
    ]);

    if (resFormatos.data) setFormatosOpcoes(resFormatos.data);
    if (resCores.data) setCoresOpcoes(resCores.data);
    if (resNum.data) setNumeracoesOpcoes(resNum.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOpcoes();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData, fetchOpcoes]);

  // ─── Inline Actions ────────────────────────────────────────────────────────

  function startCreate(itemId: number) {
    const currentItem = itens.find(i => i.id === itemId);
    const saldo = currentItem ? currentItem.saldo_a_distribuir : 0;
    if (saldo <= 0) {
      showToast({ type: "error", title: "Ação bloqueada", description: "Não há saldo disponível para adicionar novo modelo." });
      return;
    }

    // eslint-disable-next-line react-hooks/purity
    const newDraft: ModeloDraft = { ...EMPTY_DRAFT, id: `new_${Date.now()}`, quantidade: String(saldo) };
    setEditingDrafts((prev) => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), newDraft],
    }));
  }

  function startEdit(itemId: number, modelo: PedidoModeloRow) {
    setEditingDrafts((prev) => {
      const current = prev[itemId] || [];
      if (current.some((d) => d.id === modelo.id)) return prev; // já em edição
      return {
        ...prev,
        [itemId]: [...current, draftFromModelo(modelo)],
      };
    });
  }

  function startCopy(itemId: number, modelo: PedidoModeloRow) {
    const draft = draftFromModelo(modelo);
    // eslint-disable-next-line react-hooks/purity
    draft.id = `new_${Date.now()}`; // Força a ser um novo temporário

    const currentItem = itens.find(i => i.id === itemId);
    if (currentItem) {
      if (Number(draft.quantidade) > currentItem.saldo_a_distribuir) {
        draft.quantidade = Math.max(0, currentItem.saldo_a_distribuir).toString();
      }
    }

    setEditingDrafts((prev) => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), draft],
    }));
  }

  function cancelEdit(itemId: number, draftId: number | string) {
    setEditingDrafts((prev) => {
      const current = prev[itemId] || [];
      const updated = current.filter((d) => d.id !== draftId);
      return {
        ...prev,
        [itemId]: updated,
      };
    });
  }

  function updateDraft(itemId: number, draftId: number | string, partial: Partial<ModeloDraft>) {
    setEditingDrafts((prev) => {
      const current = prev[itemId] || [];
      const updated = current.map((d) => (d.id === draftId ? { ...d, ...partial } : d));
      return {
        ...prev,
        [itemId]: updated,
      };
    });
  }

  async function handleSaveNew(itemId: number, draft: ModeloDraft) {
    if (!idInt || idInt === 0) {
      showToast({ type: "warning", title: "Proposta não salva", description: "Salve a proposta para persistir os modelos no banco." });
      return;
    }

    const input = draftToInput(draft, idInt, itemId);

    const currentItem = itens.find((i) => i.id === itemId);
    if (currentItem) {
      const distributedOthers = currentItem.modelos
        .filter((m) => m.id !== draft.id)
        .reduce((sum, m) => sum + m.quantidade, 0);

      const newTotal = distributedOthers + input.quantidade;
      if (newTotal > currentItem.qtd) {
        showToast({
          type: "error",
          title: "Quantidade excedida",
          description: `A soma (${newTotal}) ultrapassa a quantidade do item (${currentItem.qtd}). Saldo disponível: ${currentItem.qtd - distributedOthers}`,
        });
        return;
      }
    }

    const draftKey = String(draft.id);
    setSavingCards((prev) => ({ ...prev, [draftKey]: true }));

    const result = await criarModelo(input);
    if (result.success) {
      showToast({ type: "success", title: "Modelo criado", description: `Modelo salvo com sucesso.` });
      
      // Mantém aberto trocando o ID temporário pelo real
      setEditingDrafts((prev) => {
        const current = prev[itemId] || [];
        return {
          ...prev,
          [itemId]: current.map((d) => (d.id === draft.id && result.data ? { ...d, id: result.data.id } : d)),
        };
      });
      
      await fetchData();
    } else {
      showToast({ type: "error", title: "Erro ao criar", description: result.errorMessage || "Ocorreu um erro." });
    }
    setSavingCards((prev) => ({ ...prev, [draftKey]: false }));
  }

  const handlePartialSave = useCallback(
    async (itemId: number, draftId: number, partial: Partial<ModeloDraft>, setStatus: (s: any) => void) => {
      if (!idInt || idInt === 0) return;

      const inputPartial: Partial<ModeloInput> = { id_produto_proposta_origem: itemId };
      if (partial.nome_modelo !== undefined) inputPartial.nome_modelo = partial.nome_modelo;
      if (partial.padrao !== undefined) inputPartial.padrao = partial.padrao;
      if (partial.quantidade !== undefined) inputPartial.quantidade = Number(partial.quantidade) || 0;
      if (partial.tipo_numeracao !== undefined) inputPartial.tipo_numeracao = partial.tipo_numeracao;
      if (partial.numeracao_inicio !== undefined) inputPartial.numeracao_inicio = Number(partial.numeracao_inicio) || null;
      if (partial.numeracao_fim !== undefined) inputPartial.numeracao_fim = Number(partial.numeracao_fim) || null;
      if (partial.verso_tipo !== undefined) inputPartial.verso_tipo = partial.verso_tipo;

      const result = await atualizarModeloParcial(draftId, inputPartial);
      if (result.success && result.data) {
        setStatus("saved");
        // Update local editing drafts without forcing a fetch
        setEditingDrafts((prev) => {
          const current = prev[itemId] || [];
          return {
            ...prev,
            [itemId]: current.map((d) => (d.id === draftId ? { ...d, ...partial } : d)),
          };
        });
      } else {
        setStatus("error");
        showToast({ type: "error", title: "Erro ao salvar", description: result.errorMessage || "Falha ao salvar o modelo." });
      }
    },
    [idInt, showToast]
  );

  async function handleDeleteConfirm() {
    if (!deletingModelo) return;
    const result = await excluirModelo(deletingModelo.id);
    if (result.success) {
      showToast({ type: "success", title: "Excluído", description: "Modelo removido com sucesso." });
      setDeleteConfirmOpen(false);
      setDeletingModelo(null);
      void fetchData();
    } else {
      showToast({ type: "error", title: "Erro", description: result.errorMessage || "Falha ao excluir." });
    }
  }

  // ─── Renders ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-500"></div>
      </div>
    );
  }

  if (itens.length === 0) {
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
      {(!idInt || idInt === 0) && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm font-semibold shadow-sm">
          Aviso: Salve a proposta (abaixo) antes de gerar cobranças ou persistir modelos no banco.
        </div>
      )}
      
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-[#0b2f4a]">Boletim Técnico & Lotes</h2>
        <p className="text-sm text-slate-500">
          Distribua a quantidade de cada produto em modelos de impressão e defina regras de numeração/vias.
        </p>
      </div>

      <div className="space-y-6">
        {itens.map((item) => {
          const drafts = editingDrafts[item.id] || [];
          const isFull = item.saldo_a_distribuir <= 0;

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
                    <h3 className="font-bold text-slate-800">{item.nome_produto}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Qtd: {item.qtd}</span>
                      <span className={item.saldo_a_distribuir > 0 ? "text-amber-600" : "text-teal-600"}>
                        {item.saldo_a_distribuir > 0 ? `Restam: ${item.saldo_a_distribuir}` : "Saldo distribuído 100%"}
                      </span>
                      {item.modelo_descri && <span className="max-w-[200px] truncate">Ref: {item.modelo_descri}</span>}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => startCreate(item.id)}
                  disabled={isFull}
                  className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar modelo
                </button>
              </div>

              {!collapsedItems[item.id] && (
                <div className="p-5 space-y-4 bg-slate-50/30">
                {item.modelos.length === 0 && drafts.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-8 text-center bg-white">
                    <CheckCircle className="mb-2 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-bold text-slate-600">Nenhum modelo configurado</p>
                    <p className="mt-1 text-xs text-slate-500">Clique em &quot;Adicionar modelo&quot; para configurar.</p>
                  </div>
                )}

                {item.modelos.map((m) => {
                  const isEditing = drafts.some((d) => d.id === m.id);
                  if (isEditing) return null; // Será renderizado no mapa de drafts abaixo

                  return (
                    <div key={m.id} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-slate-800">
                            {m.nome_modelo} <span className="ml-2 text-xs font-normal text-slate-400">#{m.id}</span>
                          </h4>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
                            <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-400">Qtd:</span> {m.quantidade}</div>
                            {m.padrao && <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-400">Cor:</span> {m.padrao}</div>}
                            {m.tipo_numeracao && <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-400">Num:</span> {m.tipo_numeracao}</div>}
                            {m.verso_tipo && <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-400">Verso:</span> {m.verso_tipo}</div>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openPreview(m.padrao || "")}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                            title="Visualizar Arte"
                          >
                            <ImageIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startCopy(item.id, m)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                            title="Copiar Modelo"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(item.id, m)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-100 hover:text-blue-600"
                            title="Editar Modelo"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingModelo(m);
                              setDeleteConfirmOpen(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-100 hover:text-red-600"
                            title="Excluir Modelo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {drafts.map((d) => {
                  const maxAllowed = typeof d.id === "string" 
                    ? item.saldo_a_distribuir 
                    : item.saldo_a_distribuir + Number(item.modelos.find((m) => m.id === d.id)?.quantidade || 0);

                  return (
                    <ModeloInlineCard
                      key={d.id}
                      itemId={item.id}
                      draft={d}
                      maxQtd={maxAllowed}
                      itemIdModeloCorNum={item.id_modelo_cor_num}
                      itemIdFormato={item.id_formato}
                      coresOpcoes={coresOpcoes}
                      numeracoesOpcoes={numeracoesOpcoes}
                      formatosOpcoes={formatosOpcoes}
                      saving={savingCards[d.id as string] || false}
                      onCancel={() => cancelEdit(item.id, d.id!)}
                      onSaveNew={(localDraft) => handleSaveNew(item.id, localDraft)}
                      onPartialSave={(draftId, partial, setStatus) => handlePartialSave(item.id, draftId, partial, setStatus)}
                      onUpdateParent={(partial) => updateDraft(item.id, d.id!, partial)}
                    />
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
