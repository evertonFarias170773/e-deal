"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, Package, CheckCircle, Copy, Image as ImageIcon, AlertOctagon } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import type { PedidoModeloRow, ItemComModelos, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  listarItensComModelos,
  criarModelo,
  atualizarModelo,
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
  numeracao_inicio: string;
  numeracao_fim: string;
  verso_tipo: string;
}

const EMPTY_DRAFT: ModeloDraft = {
  nome_modelo: "",
  padrao: "",
  quantidade: "",
  tipo_numeracao: "SEM_NUMERACAO",
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

export function PedidoModelosTab({ idInt }: { idInt: number }) {
  const { showToast } = useAppToast();
  const [itens, setItens] = useState<ItemComModelos[]>([]);
  const [loading, setLoading] = useState(true);

  // States para opções dinâmicas
  const [coresOpcoes, setCoresOpcoes] = useState<{ id: number; name: string }[]>([]);
  const [numeracoesOpcoes, setNumeracoesOpcoes] = useState<{ id: number; name: string }[]>([]);

  // State de edição inline: map de idProduto -> drafts em edição
  // Para permitir múltiplos drafts num mesmo produto, usamos um array.
  const [editingDrafts, setEditingDrafts] = useState<Record<number, ModeloDraft[]>>({});
  const [savingCards, setSavingCards] = useState<Record<string, boolean>>({});

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingModelo, setDeletingModelo] = useState<PedidoModeloRow | null>(null);

  const fetchData = useCallback(async () => {
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

    const [resCores, resNum] = await Promise.all([
      supabase.from("producao_cores").select("id, name").eq("is_active", true).order("name"),
      supabase.from("producao_numeracoes").select("id, name").eq("is_active", true).order("name"),
    ]);

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
    // eslint-disable-next-line react-hooks/purity
    const newDraft: ModeloDraft = { ...EMPTY_DRAFT, id: `new_${Date.now()}` };
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

  async function handleSaveDraft(itemId: number, draft: ModeloDraft) {
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

    const isNew = typeof draft.id === "string";

    if (isNew) {
      const result = await criarModelo(input);
      if (result.success) {
        showToast({ type: "success", title: "Modelo criado", description: `Modelo salvo com sucesso.` });
        cancelEdit(itemId, draft.id as string);
        await fetchData();
      } else {
        showToast({ type: "error", title: "Erro ao criar", description: result.errorMessage || "Falha ao salvar modelo." });
      }
    } else {
      const result = await atualizarModelo(draft.id as number, input);
      if (result.success) {
        showToast({ type: "success", title: "Modelo atualizado", description: `Modelo salvo com sucesso.` });
        cancelEdit(itemId, draft.id as number);
        await fetchData();
      } else {
        showToast({ type: "error", title: "Erro ao atualizar", description: result.errorMessage || "Falha ao salvar modelo." });
      }
    }

    setSavingCards((prev) => ({ ...prev, [draftKey]: false }));
  }

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

  const renderInlineCard = (itemId: number, draft: ModeloDraft, maxQtd: number) => {
    const isNew = typeof draft.id === "string";
    const isSaving = savingCards[String(draft.id)] || false;

    return (
      <div key={draft.id} className="relative rounded-2xl border-2 border-teal-500 bg-teal-50/30 p-5 shadow-sm transition-all">
        <div className="mb-4 flex items-center justify-between border-b border-teal-100 pb-3">
          <h4 className="text-sm font-bold text-teal-800">
            {isNew ? "Novo modelo" : `Modelo #${draft.id}`}
          </h4>
          <div className="flex gap-2">
            <button
              onClick={() => cancelEdit(itemId, draft.id!)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => handleSaveDraft(itemId, draft)}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {isSaving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="col-span-1 sm:col-span-2">
            <label className={labelClass}>Modelo *</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Ex: Talão 10x15"
              value={draft.nome_modelo}
              onChange={(e) => updateDraft(itemId, draft.id!, { nome_modelo: e.target.value })}
            />
          </div>

          <div>
            <label className={labelClass}>Cor papel *</label>
            <select
              className={inputClass}
              value={draft.padrao}
              onChange={(e) => updateDraft(itemId, draft.id!, { padrao: e.target.value })}
            >
              <option value="">Selecione...</option>
              {coresOpcoes.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>
              Quantidade * <span className="text-teal-600 lowercase font-normal ml-1">(Máx: {maxQtd})</span>
            </label>
            <input
              type="number"
              className={inputClass}
              min={1}
              max={maxQtd}
              value={draft.quantidade}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (val > maxQtd) val = maxQtd;
                updateDraft(itemId, draft.id!, { quantidade: val ? String(val) : "" });
              }}
            />
          </div>

          <div>
            <label className={labelClass}>Tipo Numeração</label>
            <select
              className={inputClass}
              value={draft.tipo_numeracao}
              onChange={(e) => {
                const tipo = e.target.value;
                updateDraft(itemId, draft.id!, {
                  tipo_numeracao: tipo,
                  numeracao_inicio: tipo !== "SEQUENCIAL" ? "" : draft.numeracao_inicio,
                  numeracao_fim: tipo !== "SEQUENCIAL" ? "" : draft.numeracao_fim,
                });
              }}
            >
              {numeracoesOpcoes.map((n) => (
                <option key={n.id} value={n.name}>{n.name}</option>
              ))}
              <option value="SEM_NUMERACAO">Sem Numeração</option>
              <option value="SEQUENCIAL">Sequencial</option>
            </select>
          </div>

          {draft.tipo_numeracao === "SEQUENCIAL" && (
            <>
              <div>
                <label className={labelClass}>Nº Inicial *</label>
                <input
                  type="number"
                  className={inputClass}
                  value={draft.numeracao_inicio}
                  onChange={(e) => updateDraft(itemId, draft.id!, { numeracao_inicio: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Nº Final *</label>
                <input
                  type="number"
                  className={inputClass}
                  value={draft.numeracao_fim}
                  onChange={(e) => updateDraft(itemId, draft.id!, { numeracao_fim: e.target.value })}
                />
              </div>
            </>
          )}

          <div>
            <label className={labelClass}>Verso</label>
            <select
              className={inputClass}
              value={draft.verso_tipo}
              onChange={(e) => updateDraft(itemId, draft.id!, { verso_tipo: e.target.value })}
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
  };

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
          const drafts = editingDrafts[item.id] || [];
          const isFull = item.saldo_a_distribuir <= 0;

          return (
            <div key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/50 p-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-100 text-teal-600">
                    <Package className="h-6 w-6" />
                  </div>
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
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 cursor-not-allowed"
                            title="Visualizar Arte (Em breve)"
                            disabled
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

                {drafts.map((draft) => {
                  const maxAllowed = typeof draft.id === "string" 
                    ? item.saldo_a_distribuir 
                    : item.saldo_a_distribuir + Number(item.modelos.find(m => m.id === draft.id)?.quantidade || 0);
                  
                  return renderInlineCard(item.id, draft, maxAllowed);
                })}
              </div>
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
    </div>
  );
}
